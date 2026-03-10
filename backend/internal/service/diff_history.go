package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// parsePK parses a URL-encoded JSON PK map and returns it as-is.
// Supports both single and composite primary keys.
func parsePK(pkJSON string) (map[string]interface{}, error) {
	var pkMap map[string]interface{}
	if err := json.Unmarshal([]byte(pkJSON), &pkMap); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk JSON"}
	}
	if len(pkMap) < 1 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "pk must not be empty"}
	}
	return pkMap, nil
}

// HistoryCommits returns the merge history by querying dolt_tags (merged/* tags).
// Each merged/* tag is created during ApproveRequest with the merge commit hash and message.
// keyword: substring match on message or tag_name (empty = no filter).
// fromDate/toDate: ISO date "YYYY-MM-DD" inclusive range (empty = no filter).
// searchField: "message" (default) | "branch" — controls keyword matching target.
// filterTable/filterPk: if both set, further filter to commits that changed the specific record.
func (s *Service) HistoryCommits(ctx context.Context, targetID, dbName, branchName string, page, pageSize int, keyword, fromDate, toDate, searchField, filterTable, filterPk string) ([]model.HistoryCommit, error) {
	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	offset := (page - 1) * pageSize

	// Build WHERE conditions for dolt_tags query
	var conditions []string
	var args []interface{}

	conditions = append(conditions, "tag_name LIKE 'merged/%'")

	// Optional keyword filter
	if keyword != "" {
		normalizedKeyword := normalizeWorkItemSearchKeyword(keyword)
		escapedKw := strings.ReplaceAll(keyword, "|", "||")
		escapedKw = strings.ReplaceAll(escapedKw, "%", "|%")
		escapedKw = strings.ReplaceAll(escapedKw, "_", "|_")
		if searchField == "branch" {
			if normalizedKeyword == "" {
				normalizedKeyword = keyword
			}
			escapedKw = strings.ReplaceAll(normalizedKeyword, "|", "||")
			escapedKw = strings.ReplaceAll(escapedKw, "%", "|%")
			escapedKw = strings.ReplaceAll(escapedKw, "_", "|_")
			// Search by work item name: merged/{keyword}/NN
			conditions = append(conditions, "tag_name LIKE ? ESCAPE '|'")
			args = append(args, "merged/"+escapedKw+"/%")
		} else {
			// Search by message
			conditions = append(conditions, "message LIKE ? ESCAPE '|'")
			args = append(args, "%"+escapedKw+"%")
		}
	}

	// Optional date range filters
	if fromDate != "" {
		conditions = append(conditions, "date >= ?")
		args = append(args, fromDate)
	}
	if toDate != "" {
		conditions = append(conditions, "date <= ?")
		args = append(args, toDate+" 23:59:59")
	}

	// When filtering by record, fetch a larger batch (paginate after filtering).
	fetchLimit := pageSize
	fetchOffset := offset
	if filterTable != "" && filterPk != "" {
		fetchLimit = 500
		fetchOffset = 0
	}

	query := "SELECT tag_name, tag_hash, tagger, message, date FROM dolt_tags"
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY date DESC LIMIT ? OFFSET ?"
	args = append(args, fetchLimit, fetchOffset)

	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query merge tags: %w", err)
	}

	// Collect commits — must close rows explicitly before any potential record filter query.
	commits := make([]model.HistoryCommit, 0)
	for rows.Next() {
		var tagName, tagHash, tagger, message, date string
		if err := rows.Scan(&tagName, &tagHash, &tagger, &message, &date); err != nil {
			rows.Close()
			return nil, fmt.Errorf("failed to scan tag: %w", err)
		}
		c := model.HistoryCommit{
			Hash:      tagHash,
			Author:    tagger,
			Message:   message,
			Timestamp: date,
		}
		if workItem, _, ok := parseArchiveTag(tagName); ok {
			c.MergeBranch = "wi/" + workItem
		}
		commits = append(commits, c)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close() // Explicit close BEFORE potential record filter query on same connection.

	// If no record filter, return with pagination already applied by the query.
	if filterTable == "" || filterPk == "" {
		return commits, nil
	}

	// Steps 2-4: Further filter to commits that changed the specific record.

	if err := validation.ValidateIdentifier("filter_table", filterTable); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid filter_table name"}
	}

	pkMap, err := parsePK(filterPk)
	if err != nil {
		return nil, err
	}

	if len(commits) == 0 {
		return make([]model.HistoryCommit, 0), nil
	}

	// Build IN clause for commit hashes.
	hashPlaceholders := make([]string, len(commits))
	hashArgs := make([]interface{}, len(commits))
	for i, c := range commits {
		hashPlaceholders[i] = "?"
		hashArgs[i] = c.Hash
	}

	// Build PK WHERE conditions.
	whereParts := make([]string, 0, len(pkMap))
	pkArgs := make([]interface{}, 0, len(pkMap))
	for k, v := range pkMap {
		if err := validation.ValidateIdentifier("pk column", k); err != nil {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk column name"}
		}
		if fv, ok := v.(float64); ok && fv == float64(int64(fv)) {
			v = strconv.FormatInt(int64(fv), 10)
		}
		whereParts = append(whereParts, fmt.Sprintf("`%s` = ?", k))
		pkArgs = append(pkArgs, v)
	}

	histQuery := fmt.Sprintf(
		"SELECT * FROM `dolt_history_%s` WHERE %s AND commit_hash IN (%s) ORDER BY commit_date DESC",
		filterTable,
		strings.Join(whereParts, " AND "),
		strings.Join(hashPlaceholders, ", "),
	)
	allHistArgs := make([]interface{}, 0, len(pkArgs)+len(hashArgs))
	allHistArgs = append(allHistArgs, pkArgs...)
	allHistArgs = append(allHistArgs, hashArgs...)

	histRows, err := conn.QueryContext(ctx, histQuery, allHistArgs...)
	if err != nil {
		// If history table query fails (e.g. table not tracked), return empty gracefully.
		return make([]model.HistoryCommit, 0), nil
	}

	histCols, err := histRows.Columns()
	if err != nil {
		histRows.Close()
		return nil, fmt.Errorf("failed to get history columns: %w", err)
	}

	type histSnap struct {
		commitHash string
		vals       map[string]interface{}
	}
	var snapshots []histSnap

	for histRows.Next() {
		vals := make([]interface{}, len(histCols))
		vPtrs := make([]interface{}, len(histCols))
		for i := range vals {
			vPtrs[i] = &vals[i]
		}
		if err := histRows.Scan(vPtrs...); err != nil {
			histRows.Close()
			return nil, fmt.Errorf("failed to scan history row: %w", err)
		}
		snap := histSnap{vals: make(map[string]interface{})}
		for i, col := range histCols {
			v := vals[i]
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			switch col {
			case "commit_hash":
				if sv, ok := v.(string); ok {
					snap.commitHash = sv
				}
			case "commit_date", "committer":
				// skip metadata columns
			default:
				snap.vals[col] = v
			}
		}
		snapshots = append(snapshots, snap)
	}
	if err := histRows.Err(); err != nil {
		histRows.Close()
		return nil, err
	}
	histRows.Close()

	if len(snapshots) == 0 {
		return make([]model.HistoryCommit, 0), nil
	}

	// Step 3: Find commit hashes where record values changed.
	// snapshots are ORDER BY commit_date DESC: index 0 = newest, index n-1 = oldest.
	// Compare each snapshot to the next (older) one; if different, include it.
	changedHashes := make(map[string]bool)
	for i, snap := range snapshots {
		if i == len(snapshots)-1 {
			// Oldest merge snapshot: include (no prior merge to compare against).
			changedHashes[snap.commitHash] = true
		} else {
			older := snapshots[i+1]
			changed := len(snap.vals) != len(older.vals)
			if !changed {
				for k, av := range snap.vals {
					if fmt.Sprintf("%v", av) != fmt.Sprintf("%v", older.vals[k]) {
						changed = true
						break
					}
				}
			}
			if changed {
				changedHashes[snap.commitHash] = true
			}
		}
	}

	// Step 4: Filter mergeCommits to changedHashes, then apply pagination.
	filtered := make([]model.HistoryCommit, 0)
	for _, c := range commits {
		if changedHashes[c.Hash] {
			filtered = append(filtered, c)
		}
	}

	startIdx := (page - 1) * pageSize
	if startIdx >= len(filtered) {
		return make([]model.HistoryCommit, 0), nil
	}
	endIdx := startIdx + pageSize
	if endIdx > len(filtered) {
		endIdx = len(filtered)
	}
	return filtered[startIdx:endIdx], nil
}

// HistoryRow returns all historical snapshots of a specific row from dolt_history_{table}.
// Snapshots are returned newest-first, up to limit entries.
func (s *Service) HistoryRow(ctx context.Context, targetID, dbName, branchName, table, pkJSON string, limit int) (*model.HistoryRowResponse, error) {
	if err := validation.ValidateIdentifier("table", table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}

	pkMap, err := parsePK(pkJSON)
	if err != nil {
		return nil, err
	}

	// Build WHERE clause from PK columns
	whereParts := make([]string, 0, len(pkMap))
	whereArgs := make([]interface{}, 0, len(pkMap))
	for k, v := range pkMap {
		if err := validation.ValidateIdentifier("pk column", k); err != nil {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk column name"}
		}
		// Convert JSON number (float64) to integer string for query
		if fv, ok := v.(float64); ok && fv == float64(int64(fv)) {
			v = strconv.FormatInt(int64(fv), 10)
		}
		whereParts = append(whereParts, fmt.Sprintf("`%s` = ?", k))
		whereArgs = append(whereArgs, v)
	}

	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	histTable := fmt.Sprintf("dolt_history_%s", table)
	query := fmt.Sprintf(
		"SELECT * FROM `%s` WHERE %s ORDER BY commit_date DESC LIMIT ?",
		histTable, strings.Join(whereParts, " AND "),
	)
	whereArgs = append(whereArgs, limit)

	rows, err := conn.QueryContext(ctx, query, whereArgs...)
	if err != nil {
		return nil, fmt.Errorf("failed to query row history: %w", err)
	}
	defer rows.Close()

	colNames, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	snapshots := make([]model.HistoryRowSnapshot, 0)
	for rows.Next() {
		values := make([]interface{}, len(colNames))
		valuePtrs := make([]interface{}, len(colNames))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, fmt.Errorf("failed to scan history row: %w", err)
		}

		snap := model.HistoryRowSnapshot{Row: make(map[string]interface{})}
		for i, col := range colNames {
			val := values[i]
			if b, ok := val.([]byte); ok {
				val = string(b)
			}
			switch col {
			case "commit_hash":
				if sv, ok := val.(string); ok {
					snap.CommitHash = sv
				}
			case "commit_date":
				if sv, ok := val.(string); ok {
					snap.CommitDate = sv
				} else {
					snap.CommitDate = fmt.Sprintf("%v", val)
				}
			case "committer":
				if sv, ok := val.(string); ok {
					snap.Committer = sv
				}
			default:
				snap.Row[col] = val
			}
		}
		snapshots = append(snapshots, snap)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("history row query error: %w", err)
	}

	return &model.HistoryRowResponse{Snapshots: snapshots}, nil
}
