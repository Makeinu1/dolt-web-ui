//go:build integration

package service

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func testRepoRoot() string {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		panic("failed to resolve integration test path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
}

func runTestEnvCommand(name string) error {
	cmd := exec.Command(filepath.Join(testRepoRoot(), "scripts", "testenv", name))
	cmd.Dir = testRepoRoot()
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func TestMain(m *testing.M) {
	if err := runTestEnvCommand("reset"); err != nil {
		panic(err)
	}

	code := m.Run()

	if err := runTestEnvCommand("stop"); err != nil {
		panic(err)
	}

	os.Exit(code)
}
