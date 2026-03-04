/**
 * safeStorage — localStorage / sessionStorage 読み書きの安全なラッパー。
 *
 * JSON.parse が例外を投げた場合（値の破損・スキーマ変更等）は、
 * キーを自動削除してデフォルト値を返す。これにより、
 * Storage 汚染による永続的クラッシュ（P1: App Bricking）を構造的に防止する。
 */

export function safeGetJSON<T>(
    storage: Storage,
    key: string,
    defaultValue: T,
): T {
    try {
        const raw = storage.getItem(key);
        if (raw === null) return defaultValue;
        return JSON.parse(raw) as T;
    } catch {
        // Storage 汚染を自動修復: 壊れたデータを削除してデフォルトで復旧
        console.warn(`[safeStorage] corrupt data for key "${key}" — auto-cleared`);
        storage.removeItem(key);
        return defaultValue;
    }
}

export function safeSetJSON<T>(
    storage: Storage,
    key: string,
    value: T,
): void {
    try {
        storage.setItem(key, JSON.stringify(value));
    } catch {
        // QuotaExceeded 等 — 書き込み失敗は握りつぶす（永続エラーにしない）
        console.warn(`[safeStorage] failed to write key "${key}"`);
    }
}
