package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// workBranchExtractRe extracts a work branch name (wi/xxx/xx) from a commit message.
var workBranchExtractRe = regexp.MustCompile(`wi/[A-Za-z0-9._-]+/[0-9]{1,3}`)

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

// HistoryCommits returns the commit log for a branch.
// filter: "all" (default), "merges_only" (main: merge commits only),
// "exclude_auto_merge" (work branch: exclude auto-sync merges).
// keyword: substring match on message (empty = no filter).
// fromDate/toDate: ISO date "YYYY-MM-DD" inclusive range (empty = no filter).
// searchField: "message" (default) | "branch" — controls keyword matching target.
// filterTable/filterPk: if both set, further filter to commits that changed the specific record.
func (s *Service) HistoryCommits(ctx context.Context, targetID, dbName, branchName string, page, pageSize int, filter, keyword, fromDate, toDate, searchField, filterTable, filterPk string) ([]model.HistoryCommit, error) {
	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	offset := (page - 1) * pageSize

	// Build base FROM clause based on filter
	var baseFrom string
	var args []interface{}

	switch filter {
	case "merges_only":
		// Show merge commits on main: 2+ parents in dolt_commit_ancestors (standard Dolt merge)
		// OR message contains wi/xxx/xx branch pattern (our custom Approve merge commit).
		// LEFT JOIN ensures commits with our custom messages are not filtered out when
		// dolt_commit_ancestors doesn't yet reflect the merge topology.
		baseFrom = `dolt_log AS l
			LEFT JOIN (
				SELECT commit_hash FROM dolt_commit_ancestors
				GROUP BY commit_hash HAVING COUNT(*) > 1
			) AS m ON l.commit_hash = m.commit_hash`

	case "exclude_auto_merge":
		// For work branches: exclude auto-generated merge commits
		baseFrom = `dolt_log AS l`
	case "exclude_comments":
		baseFrom = `dolt_log AS l`
	case "exclude_auto_merge_and_comments":
		baseFrom = `dolt_log AS l`
	default:
		baseFrom = `dolt_log AS l`
	}

	// Build WHERE conditions
	var conditions []string

	switch filter {
	case "merges_only":
		// Keep only commits that are either standard merge commits (2+ parents via LEFT JOIN)
		// OR contain our wi/xxx/xx branch name pattern (custom Approve merge message).
		conditions = append(conditions, "(m.commit_hash IS NOT NULL OR l.message REGEXP 'wi/[A-Za-z0-9._-]+/[0-9]+')")
	case "exclude_auto_merge":
		conditions = append(conditions, "l.message NOT LIKE 'Merge branch%'", "l.message != 'Merge main with conflict resolution'")
	case "exclude_comments":
		conditions = append(conditions, "l.message NOT LIKE '[comment]%'")
	case "exclude_auto_merge_and_comments":
		conditions = append(conditions, "l.message NOT LIKE 'Merge branch%'", "l.message != 'Merge main with conflict resolution'", "l.message NOT LIKE '[comment]%'")
	}

	// Optional keyword filter — use | as ESCAPE character to avoid Dolt parser issues with backslash.
	if keyword != "" {
		escapedKw := strings.ReplaceAll(keyword, "|", "||")
		escapedKw = strings.ReplaceAll(escapedKw, "%", "|%")
		escapedKw = strings.ReplaceAll(escapedKw, "_", "|_")
		conditions = append(conditions, "l.message LIKE ? ESCAPE '|'")
		if searchField == "branch" {
			args = append(args, "%wi/"+escapedKw+"%")
		} else {
			args = append(args, "%"+escapedKw+"%")
		}
	}

	// Optional date range filters
	if fromDate != "" {
		conditions = append(conditions, "l.date >= ?")
		args = append(args, fromDate)
	}
	if toDate != "" {
		conditions = append(conditions, "l.date <= ?")
		args = append(args, toDate+" 23:59:59")
	}

	// Assemble query. When filtering by record, fetch a larger batch (paginate after filtering).
	fetchLimit := pageSize
	fetchOffset := offset
	if filterTable != "" && filterPk != "" {
		fetchLimit = 500
		fetchOffset = 0
	}

	query := fmt.Sprintf("SELECT l.commit_hash, l.committer, l.message, l.date FROM %s", baseFrom)
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY l.date DESC LIMIT ? OFFSET ?"
	args = append(args, fetchLimit, fetchOffset)

	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query history: %w", err)
	}

	// Collect commits — must close rows explicitly before any potential Step 2 query.
	commits := make([]model.HistoryCommit, 0)
	for rows.Next() {
		var c model.HistoryCommit
		if err := rows.Scan(&c.Hash, &c.Author, &c.Message, &c.Timestamp); err != nil {
			rows.Close()
			return nil, fmt.Errorf("failed to scan commit: %w", err)
		}
		// 2a: Extract work branch name from merge commit message
		if filter == "merges_only" {
			if m := workBranchExtractRe.FindString(c.Message); m != "" {
				c.MergeBranch = m
			}
		}
		commits = append(commits, c)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close() // Explicit close BEFORE potential Step 2 query on same connection.

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
