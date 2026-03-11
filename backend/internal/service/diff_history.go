package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

func historyIntegrityError(commitHash string, err error) *model.APIError {
	details := map[string]string{}
	if commitHash != "" {
		details["commit_hash"] = commitHash
	}
	if err != nil {
		details["cause"] = err.Error()
	}
	return &model.APIError{
		Status:  500,
		Code:    model.CodeInternal,
		Msg:     "履歴の整合性を確認できませんでした。時間をおいて再試行してください。",
		Details: details,
	}
}

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

// HistoryCommits returns the approval merge history.
//
// B-PR2 (footer-first read): primary source is the main branch commit history.
// Commits that carry a valid Dolt-Approval-Schema footer are returned as approval records.
// Commits without a footer fall back to the merged/* legacy adapter (pre-cutover).
// An invalid footer (schema present but fields wrong) returns an integrity error.
//
// keyword: substring match on message or work branch (empty = no filter).
// fromDate/toDate: ISO date "YYYY-MM-DD" inclusive range (empty = no filter).
// searchField: "message" (default) | "branch".
// filterTable/filterPk: if both set, further filter to commits that changed the specific record.
func (s *Service) HistoryCommits(ctx context.Context, targetID, dbName, branchName string, page, pageSize int, keyword, fromDate, toDate, searchField, filterTable, filterPk string) (*model.HistoryCommitsResponse, error) {
	conn, err := s.connHistoryRevision(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	// --- Step 1: build a merged/* tag index for legacy adapter lookups ---
	// mergedTagIndex maps merge commit hash → workItem name.
	mergedTagIndex, err := buildMergedTagIndex(ctx, conn)
	if err != nil {
		return nil, fmt.Errorf("failed to build merged/* tag index: %w", err)
	}

	// --- Step 2: walk main commit history and classify each commit ---
	//
	// We use dolt_log on the effective branch (branchName resolves to main or a
	// tag/hash for history read). We collect all candidates and then apply
	// keyword / date filters in Go so that footer fields are searchable.
	//
	// dolt_log columns: commit_hash, committer, committer_email, date, message.
	logQuery := "SELECT commit_hash, committer, date, message FROM dolt_log ORDER BY date DESC LIMIT 2000"
	logRows, err := conn.QueryContext(ctx, logQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to query commit log: %w", err)
	}

	type rawCommit struct {
		hash      string
		committer string
		date      string
		message   string
	}
	var rawCommits []rawCommit
	for logRows.Next() {
		var rc rawCommit
		if err := logRows.Scan(&rc.hash, &rc.committer, &rc.date, &rc.message); err != nil {
			logRows.Close()
			return nil, fmt.Errorf("failed to scan commit log: %w", err)
		}
		rawCommits = append(rawCommits, rc)
	}
	if err := logRows.Err(); err != nil {
		logRows.Close()
		return nil, err
	}
	logRows.Close()

	// --- Step 3: classify each commit and build the history list ---
	commits := make([]model.HistoryCommit, 0)
	for _, rc := range rawCommits {
		footer, parseErr := parseApprovalFooter(rc.message)

		switch {
		case parseErr != nil:
			// Footer marker present but invalid — integrity error, must not silent-skip.
			return nil, historyIntegrityError(rc.hash, parseErr)

		case footer != nil:
			// Post-cutover: footer is the primary truth.
			c := model.HistoryCommit{
				Hash:        rc.hash,
				Author:      rc.committer,
				Message:     humanSubjectFromApprovalMessage(rc.message),
				Timestamp:   rc.date,
				MergeBranch: footer.WorkBranch,
			}
			commits = append(commits, c)

		default:
			// No footer — check merged/* legacy adapter (pre-cutover).
			legacyWorkItem, hasLegacy := mergedTagIndex[rc.hash]
			if !hasLegacy {
				// Normal (non-approval) commit — skip.
				continue
			}
			c := model.HistoryCommit{
				Hash:        rc.hash,
				Author:      rc.committer,
				Message:     rc.message,
				Timestamp:   rc.date,
				MergeBranch: "wi/" + legacyWorkItem,
			}
			commits = append(commits, c)
		}
	}

	// --- Step 4: apply keyword / date filters in Go ---
	commits = filterHistoryCommits(commits, keyword, fromDate, toDate, searchField)

	// When filtering by record, fetch a larger batch (paginate after filtering).
	if filterTable == "" || filterPk == "" {
		return &model.HistoryCommitsResponse{
			Commits: paginateCommits(commits, page, pageSize),
			ReadResultFields: model.ReadResultFields{
				ReadIntegrity: model.ReadIntegrityComplete,
			},
		}, nil
	}

	// record-level filter: further narrow to commits that changed a specific row.

	// Steps 2-4: Further filter to commits that changed the specific record.

	if err := validation.ValidateIdentifier("filter_table", filterTable); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid filter_table name"}
	}

	pkMap, err := parsePK(filterPk)
	if err != nil {
		return nil, err
	}

	if len(commits) == 0 {
		return &model.HistoryCommitsResponse{
			Commits: make([]model.HistoryCommit, 0),
			ReadResultFields: model.ReadResultFields{
				ReadIntegrity: model.ReadIntegrityComplete,
			},
		}, nil
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
		return &model.HistoryCommitsResponse{
			Commits: make([]model.HistoryCommit, 0),
			ReadResultFields: model.ReadResultFields{
				ReadIntegrity: model.ReadIntegrityComplete,
			},
		}, nil
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
		return &model.HistoryCommitsResponse{
			Commits: make([]model.HistoryCommit, 0),
			ReadResultFields: model.ReadResultFields{
				ReadIntegrity: model.ReadIntegrityComplete,
			},
		}, nil
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
		return &model.HistoryCommitsResponse{
			Commits: make([]model.HistoryCommit, 0),
			ReadResultFields: model.ReadResultFields{
				ReadIntegrity: model.ReadIntegrityComplete,
			},
		}, nil
	}
	endIdx := startIdx + pageSize
	if endIdx > len(filtered) {
		endIdx = len(filtered)
	}
	return &model.HistoryCommitsResponse{
		Commits: filtered[startIdx:endIdx],
		ReadResultFields: model.ReadResultFields{
			ReadIntegrity: model.ReadIntegrityComplete,
		},
	}, nil
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

	conn, err := s.connHistoryRevision(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, err
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

// --- B-PR2 helpers ---

// buildMergedTagIndex queries all merged/* tags and returns a map from
// tag_hash (approval merge commit hash) to workItem name.
// This is used as a legacy adapter for pre-cutover approvals that do not
// carry a Dolt-Approval-Schema footer on the main commit.
func buildMergedTagIndex(ctx context.Context, conn *sql.Conn) (map[string]string, error) {
	rows, err := conn.QueryContext(ctx, "SELECT tag_name, tag_hash FROM dolt_tags WHERE tag_name LIKE 'merged/%'")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	idx := make(map[string]string) // hash → workItem
	for rows.Next() {
		var tagName, tagHash string
		if err := rows.Scan(&tagName, &tagHash); err != nil {
			return nil, err
		}
		workItem, _, ok := parseArchiveTag(tagName)
		if !ok {
			continue
		}
		idx[tagHash] = workItem
	}
	return idx, rows.Err()
}

// humanSubjectFromApprovalMessage extracts the first line (human-readable subject)
// from an approval commit message that also carries a footer trailer block.
func humanSubjectFromApprovalMessage(msg string) string {
	for _, line := range strings.SplitN(msg, "\n", 2) {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			return trimmed
		}
	}
	return msg
}

// filterHistoryCommits applies keyword and date filters to a list of history commits.
// Filtering is done in Go so that footer-derived fields (MergeBranch, Message) are searchable.
func filterHistoryCommits(commits []model.HistoryCommit, keyword, fromDate, toDate, searchField string) []model.HistoryCommit {
	if keyword == "" && fromDate == "" && toDate == "" {
		return commits
	}
	normalizedKw := ""
	if keyword != "" {
		normalizedKw = normalizeWorkItemSearchKeyword(keyword)
		if normalizedKw == "" {
			normalizedKw = keyword
		}
	}
	filtered := make([]model.HistoryCommit, 0, len(commits))
	for _, c := range commits {
		// Keyword filter
		if keyword != "" {
			var haystack string
			if searchField == "branch" {
				haystack = strings.ToLower(c.MergeBranch)
			} else {
				haystack = strings.ToLower(c.Message)
			}
			needle := strings.ToLower(normalizedKw)
			if !strings.Contains(haystack, needle) {
				continue
			}
		}
		// Date filter — Timestamp is "YYYY-MM-DD HH:MM:SS" or RFC3339.
		ts := c.Timestamp
		if len(ts) >= 10 {
			dateOnly := ts[:10]
			if fromDate != "" && dateOnly < fromDate {
				continue
			}
			if toDate != "" && dateOnly > toDate {
				continue
			}
		}
		filtered = append(filtered, c)
	}
	return filtered
}

// paginateCommits returns the page-sized slice of commits for the given 1-based page.
func paginateCommits(commits []model.HistoryCommit, page, pageSize int) []model.HistoryCommit {
	if page < 1 {
		page = 1
	}
	start := (page - 1) * pageSize
	if start >= len(commits) {
		return make([]model.HistoryCommit, 0)
	}
	end := start + pageSize
	if end > len(commits) {
		end = len(commits)
	}
	return commits[start:end]
}
