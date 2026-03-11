package service

import (
	"context"
	"fmt"
	"log"
	"time"
)

type branchQueryabilityResult struct {
	Ready    bool
	Attempts int
	Elapsed  time.Duration
	LastErr  error
}

type branchReadinessProbe func(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult

func (s *Service) branchReadyTimeout() time.Duration {
	return time.Duration(s.cfg.Server.Recovery.BranchReadySec) * time.Second
}

func (s *Service) branchReadyPollInterval() time.Duration {
	return time.Duration(s.cfg.Server.Recovery.BranchReadyPollMS) * time.Millisecond
}

func (s *Service) branchReadyRetryAfterMS() int {
	return s.cfg.Server.Recovery.BranchReadySec * 1000
}

func (s *Service) branchReadyAttempts() int {
	timeout := s.branchReadyTimeout()
	poll := s.branchReadyPollInterval()
	if timeout <= 0 || poll <= 0 {
		return 1
	}
	attempts := int(timeout / poll)
	if timeout%poll != 0 {
		attempts++
	}
	if attempts < 1 {
		return 1
	}
	return attempts
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *Service) checkBranchQueryableOnce(ctx context.Context, targetID, dbName, branch string) error {
	conn, err := s.connAllowedRevision(ctx, targetID, dbName, branch)
	if err != nil {
		return err
	}
	defer conn.Close()

	rows, err := conn.QueryContext(ctx, "SHOW TABLES")
	if err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	headConn, err := s.repo.ConnRevision(ctx, targetID, dbName, "main")
	if err != nil {
		return err
	}
	defer headConn.Close()

	var hash string
	if err := headConn.QueryRowContext(ctx, "SELECT HASHOF(?)", branch).Scan(&hash); err != nil {
		return err
	}
	if hash == "" {
		return fmt.Errorf("empty head for branch %s", branch)
	}
	return nil
}

func (s *Service) branchReadiness(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult {
	return s.branchReadinessProbe(ctx, targetID, dbName, branch)
}

func (s *Service) probeBranchReadiness(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult {
	start := time.Now()
	attempts := s.branchReadyAttempts()
	poll := s.branchReadyPollInterval()

	result := branchQueryabilityResult{Attempts: attempts}
	for attempt := 1; attempt <= attempts; attempt++ {
		err := s.checkBranchQueryableOnce(ctx, targetID, dbName, branch)
		if err == nil {
			result.Ready = true
			result.Attempts = attempt
			result.Elapsed = time.Since(start)
			return result
		}
		result.LastErr = err
		result.Attempts = attempt

		if attempt < attempts {
			if sleepErr := sleepWithContext(ctx, poll); sleepErr != nil {
				result.LastErr = sleepErr
				break
			}
		}
	}

	result.Elapsed = time.Since(start)
	return result
}

func (r branchQueryabilityResult) Err(branch string) error {
	if r.Ready {
		return nil
	}
	if r.LastErr != nil {
		return fmt.Errorf("branch %s not queryable after %d attempts (%s): %w", branch, r.Attempts, r.Elapsed.Round(time.Millisecond), r.LastErr)
	}
	return fmt.Errorf("branch %s not queryable after %d attempts (%s)", branch, r.Attempts, r.Elapsed.Round(time.Millisecond))
}

func logBranchQueryabilityFailure(prefix, targetID, dbName, branch string, result branchQueryabilityResult) {
	log.Printf(
		"WARN: %s target=%s db=%s branch=%s attempts=%d elapsed_ms=%d last_error=%v",
		prefix,
		targetID,
		dbName,
		branch,
		result.Attempts,
		result.Elapsed.Milliseconds(),
		result.LastErr,
	)
}
