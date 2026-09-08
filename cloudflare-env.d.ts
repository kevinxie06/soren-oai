/// <reference types="@cloudflare/workers-types" />
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ARTIFACTS: R2Bucket;
    LAB_WORKER_TOKEN?: string;
    LAB_ACCESS_TOKEN?: string;
  }
}
