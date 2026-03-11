package main

import "github.com/Makeinu1/dolt-web-ui/backend/internal/footer"

type footerScanStatus string

const (
	footerScanStatusValid    footerScanStatus = "valid"
	footerScanStatusInvalid  footerScanStatus = "invalid"
	footerScanStatusNoFooter footerScanStatus = "no_footer"
)

type footerScanCommit struct {
	Hash    string
	Message string
}

type footerScanResult struct {
	Hash     string
	Status   footerScanStatus
	WorkItem string
	Problem  string
}

func scanApprovalFooters(commits []footerScanCommit) ([]footerScanResult, int) {
	results := make([]footerScanResult, 0, len(commits))
	invalidCount := 0

	for _, commit := range commits {
		parsed, err := footer.ParseApprovalFooter(commit.Message)
		result := footerScanResult{Hash: commit.Hash}

		switch {
		case err != nil:
			result.Status = footerScanStatusInvalid
			result.Problem = err.Error()
			invalidCount++
		case parsed == nil:
			result.Status = footerScanStatusNoFooter
		default:
			result.Status = footerScanStatusValid
			result.WorkItem = parsed.WorkItem
		}

		results = append(results, result)
	}

	return results, invalidCount
}
