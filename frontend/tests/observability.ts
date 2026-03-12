import { readFile } from "node:fs/promises";
import { test as base, expect, type ConsoleMessage, type Request, type Response } from "@playwright/test";

type Pattern = RegExp | string;

type LogKind = "pageerror" | "console-error" | "requestfailed" | "api-5xx";

interface LogEntry {
  kind: LogKind;
  text: string;
}

interface ObservabilityController {
  allowApiFailures: (...patterns: Pattern[]) => void;
  allowConsoleErrors: (...patterns: Pattern[]) => void;
  allowPageErrors: (...patterns: Pattern[]) => void;
  allowRequestFailures: (...patterns: Pattern[]) => void;
}

interface AllowList {
  apiFailures: Pattern[];
  consoleErrors: Pattern[];
  pageErrors: Pattern[];
  requestFailures: Pattern[];
}

function matches(patterns: Pattern[], text: string): boolean {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? text.includes(pattern) : pattern.test(text)
  );
}

function summarize(entries: LogEntry[]) {
  return entries.map((entry) => `[${entry.kind}] ${entry.text}`).join("\n");
}

function responseSummary(response: Response) {
  return `${response.status()} ${response.request().method()} ${response.url()}`;
}

function requestFailureSummary(request: Request) {
  const failure = request.failure();
  return `${request.method()} ${request.url()}${failure?.errorText ? ` :: ${failure.errorText}` : ""}`;
}

function consoleSummary(message: ConsoleMessage) {
  const location = message.location();
  const suffix = location.url ? ` @ ${location.url}${location.lineNumber ? `:${location.lineNumber}` : ""}` : "";
  return `${message.text()}${suffix}`;
}

function isDuplicateApiFailureConsole(message: ConsoleMessage) {
  if (!message.text().startsWith("Failed to load resource:")) {
    return false;
  }
  return message.location().url.includes("/api/v1/");
}

function isBenignRequestAbort(request: Request) {
  const failure = request.failure();
  if (!failure?.errorText.includes("ERR_ABORTED")) {
    return false;
  }
  // Page reloads intentionally cancel in-flight GETs; keep POST aborts noisy.
  return request.method() === "GET";
}

function filterUnexpected(entries: LogEntry[], allowList: AllowList) {
  return entries.filter((entry) => {
    switch (entry.kind) {
      case "api-5xx":
        return !matches(allowList.apiFailures, entry.text);
      case "console-error":
        return !matches(allowList.consoleErrors, entry.text);
      case "pageerror":
        return !matches(allowList.pageErrors, entry.text);
      case "requestfailed":
        return !matches(allowList.requestFailures, entry.text);
      default:
        return true;
    }
  });
}

async function attachBackendLogIfPresent(testInfo: { attach: (name: string, attachment: { body: string; contentType: string }) => Promise<void> }) {
  const backendLogPath = process.env.PLAYWRIGHT_BACKEND_LOG;
  if (!backendLogPath) return;
  try {
    const content = await readFile(backendLogPath, "utf8");
    const tail = content.split("\n").slice(-200).join("\n").trim();
    if (!tail) return;
    await testInfo.attach("backend-log-tail", {
      body: tail,
      contentType: "text/plain",
    });
  } catch {
    // Ignore missing backend log files in mock-only runs.
  }
}

export const test = base.extend<{ observability: ObservabilityController; _observabilityAllowList: AllowList }>({
  _observabilityAllowList: [async ({}, use) => {
    await use({
      apiFailures: [],
      consoleErrors: [],
      pageErrors: [],
      requestFailures: [],
    });
  }, { auto: true }],
  observability: async ({ _observabilityAllowList }, use) => {
    await use({
      allowApiFailures: (...patterns: Pattern[]) => _observabilityAllowList.apiFailures.push(...patterns),
      allowConsoleErrors: (...patterns: Pattern[]) => _observabilityAllowList.consoleErrors.push(...patterns),
      allowPageErrors: (...patterns: Pattern[]) => _observabilityAllowList.pageErrors.push(...patterns),
      allowRequestFailures: (...patterns: Pattern[]) => _observabilityAllowList.requestFailures.push(...patterns),
    });
  },
  page: async ({ page, _observabilityAllowList }, use, testInfo) => {
    const entries: LogEntry[] = [];

    page.on("pageerror", (error) => {
      entries.push({ kind: "pageerror", text: error.stack ?? error.message });
    });
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (isDuplicateApiFailureConsole(message)) return;
      entries.push({ kind: "console-error", text: consoleSummary(message) });
    });
    page.on("requestfailed", (request) => {
      if (isBenignRequestAbort(request)) return;
      entries.push({ kind: "requestfailed", text: requestFailureSummary(request) });
    });
    page.on("response", (response) => {
      if (!response.url().includes("/api/v1/") || response.status() < 500) return;
      entries.push({ kind: "api-5xx", text: responseSummary(response) });
    });

    await use(page);

    if (entries.length > 0) {
      await testInfo.attach("client-observability", {
        body: summarize(entries),
        contentType: "text/plain",
      });
    }
    await attachBackendLogIfPresent(testInfo);

    const unexpected = filterUnexpected(entries, _observabilityAllowList);
    if (unexpected.length > 0) {
      throw new Error(`Unexpected client/backend errors observed:\n${summarize(unexpected)}`);
    }
  },
});

export { expect } from "@playwright/test";
export type { APIRequestContext, Page, TestInfo } from "@playwright/test";
