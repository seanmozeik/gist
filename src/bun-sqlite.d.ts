declare module 'bun:sqlite' {
  export interface BunSqliteDatabaseOptions {
    readonly?: boolean;
  }

  export interface BunSqliteStatement {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
    run: (...args: unknown[]) => unknown;
  }

  export class Database {
    constructor(filename: string, options?: BunSqliteDatabaseOptions);
    exec(sql: string): void;
    prepare(sql: string): BunSqliteStatement;
    close(): void;
    query<T = unknown>(sql: string): { all: () => T[]; run: () => unknown };
  }
}
