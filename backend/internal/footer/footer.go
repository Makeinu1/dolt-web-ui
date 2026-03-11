package footer

import (
	"fmt"
	"regexp"
	"strings"
)

// ApprovalFooter holds the machine-readable fields from a main merge commit footer.
type ApprovalFooter struct {
	Schema            string // "v1"
	RequestID         string // "req/<WorkItem>"
	WorkItem          string // "<WorkItem>"
	WorkBranch        string // "wi/<WorkItem>"
	SubmittedWorkHash string // 32-char lowercase hex

	// Optional fields
	SubmittedMainHash  string // 32-char lowercase hex (may be empty)
	RequestSubmittedAt string // RFC3339 UTC (may be empty)
}

var doltHashRe = regexp.MustCompile(`^[0-9a-z]{32}$`)

// BuildApprovalFooter constructs a commit message with human-readable subject and
// machine-readable trailer block (git trailer convention).
func BuildApprovalFooter(humanSubject string, f ApprovalFooter) string {
	var b strings.Builder
	b.WriteString(humanSubject)
	b.WriteString("\n\n")
	b.WriteString("Dolt-Approval-Schema: ")
	b.WriteString(f.Schema)
	b.WriteString("\nRequest-Id: ")
	b.WriteString(f.RequestID)
	b.WriteString("\nWork-Item: ")
	b.WriteString(f.WorkItem)
	b.WriteString("\nWork-Branch: ")
	b.WriteString(f.WorkBranch)
	b.WriteString("\nSubmitted-Work-Hash: ")
	b.WriteString(f.SubmittedWorkHash)
	if f.SubmittedMainHash != "" {
		b.WriteString("\nSubmitted-Main-Hash: ")
		b.WriteString(f.SubmittedMainHash)
	}
	if f.RequestSubmittedAt != "" {
		b.WriteString("\nRequest-Submitted-At: ")
		b.WriteString(f.RequestSubmittedAt)
	}
	return b.String()
}

// ParseApprovalFooter extracts the approval footer from a commit message.
// Returns (nil, nil) if no approval footer is present (normal commit or pre-cutover).
// Returns (nil, err) if a footer is present but invalid (data corruption — must not silent-skip).
func ParseApprovalFooter(commitMsg string) (*ApprovalFooter, error) {
	trailers := ParseTrailers(commitMsg)
	if len(trailers) == 0 {
		return nil, nil
	}

	schema := trailers["dolt-approval-schema"]
	if schema == "" {
		return nil, nil // no approval footer present
	}

	if schema != "v1" {
		return nil, fmt.Errorf("unsupported approval schema: %s", schema)
	}

	f := &ApprovalFooter{Schema: schema}
	f.RequestID = trailers["request-id"]
	f.WorkItem = trailers["work-item"]
	f.WorkBranch = trailers["work-branch"]
	f.SubmittedWorkHash = trailers["submitted-work-hash"]
	f.SubmittedMainHash = trailers["submitted-main-hash"]
	f.RequestSubmittedAt = trailers["request-submitted-at"]

	if f.RequestID == "" {
		return nil, fmt.Errorf("approval footer missing required field: Request-Id")
	}
	if f.WorkItem == "" {
		return nil, fmt.Errorf("approval footer missing required field: Work-Item")
	}
	if f.WorkBranch == "" {
		return nil, fmt.Errorf("approval footer missing required field: Work-Branch")
	}
	if f.SubmittedWorkHash == "" {
		return nil, fmt.Errorf("approval footer missing required field: Submitted-Work-Hash")
	}

	if f.RequestID != "req/"+f.WorkItem {
		return nil, fmt.Errorf("approval footer inconsistency: Request-Id=%s does not match Work-Item=%s", f.RequestID, f.WorkItem)
	}
	if f.WorkBranch != "wi/"+f.WorkItem {
		return nil, fmt.Errorf("approval footer inconsistency: Work-Branch=%s does not match Work-Item=%s", f.WorkBranch, f.WorkItem)
	}

	if !doltHashRe.MatchString(f.SubmittedWorkHash) {
		return nil, fmt.Errorf("approval footer invalid Submitted-Work-Hash: %s", f.SubmittedWorkHash)
	}
	if f.SubmittedMainHash != "" && !doltHashRe.MatchString(f.SubmittedMainHash) {
		return nil, fmt.Errorf("approval footer invalid Submitted-Main-Hash: %s", f.SubmittedMainHash)
	}

	return f, nil
}

// ParseTrailers extracts key-value pairs from the last paragraph of a commit message.
// Keys are normalized to lowercase. Git trailer format: "Key: Value".
func ParseTrailers(commitMsg string) map[string]string {
	paragraphs := strings.Split(strings.TrimSpace(commitMsg), "\n\n")
	if len(paragraphs) < 2 {
		return nil
	}

	lastParagraph := paragraphs[len(paragraphs)-1]
	lines := strings.Split(strings.TrimSpace(lastParagraph), "\n")

	trailers := make(map[string]string)
	for _, line := range lines {
		idx := strings.Index(line, ": ")
		if idx < 1 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(line[:idx]))
		value := strings.TrimSpace(line[idx+2:])
		trailers[key] = value
	}

	return trailers
}
