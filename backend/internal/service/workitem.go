package service

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var workItemNameRe = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
var workBranchNameRe = regexp.MustCompile(`^wi/[A-Za-z0-9._-]+$`)
var requestTagNameRe = regexp.MustCompile(`^req/[A-Za-z0-9._-]+$`)
var mergedTagNameRe = regexp.MustCompile(`^merged/([A-Za-z0-9._-]+)/([0-9]{2})$`)

func isWorkBranchName(branchName string) bool {
	return workBranchNameRe.MatchString(branchName)
}

func isRequestTagName(requestID string) bool {
	return requestTagNameRe.MatchString(requestID)
}

func workItemFromWorkBranch(branchName string) (string, bool) {
	if !isWorkBranchName(branchName) {
		return "", false
	}
	return strings.TrimPrefix(branchName, "wi/"), true
}

func requestIDFromWorkBranch(branchName string) (string, bool) {
	workItem, ok := workItemFromWorkBranch(branchName)
	if !ok {
		return "", false
	}
	return requestIDFromWorkItem(workItem), true
}

func requestIDFromWorkItem(workItem string) string {
	return "req/" + workItem
}

func workItemFromRequestID(requestID string) (string, bool) {
	if !isRequestTagName(requestID) {
		return "", false
	}
	return strings.TrimPrefix(requestID, "req/"), true
}

func workBranchFromRequestID(requestID string) (string, bool) {
	workItem, ok := workItemFromRequestID(requestID)
	if !ok {
		return "", false
	}
	return "wi/" + workItem, true
}

func archiveTagForWorkItem(workItem string, sequence int) string {
	return fmt.Sprintf("merged/%s/%02d", workItem, sequence)
}

func archiveTagPrefixForWorkItem(workItem string) string {
	return "merged/" + workItem + "/"
}

func parseArchiveTag(tagName string) (string, int, bool) {
	matches := mergedTagNameRe.FindStringSubmatch(tagName)
	if len(matches) != 3 {
		return "", 0, false
	}
	sequence, err := strconv.Atoi(matches[2])
	if err != nil {
		return "", 0, false
	}
	return matches[1], sequence, true
}

func normalizeWorkItemSearchKeyword(keyword string) string {
	trimmed := strings.TrimSpace(keyword)
	trimmed = strings.TrimPrefix(trimmed, "wi/")
	trimmed = strings.TrimPrefix(trimmed, "req/")
	trimmed = strings.TrimPrefix(trimmed, "merged/")
	return trimmed
}

func importWorkItemName(sourceDB, tableName string) string {
	return fmt.Sprintf("import-%s-%s", sourceDB, tableName)
}

func importWorkBranchName(sourceDB, tableName string) string {
	return "wi/" + importWorkItemName(sourceDB, tableName)
}
