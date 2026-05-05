import fs from "node:fs";

const required = [
  "D1_DATABASE_ID",
  "VERIFY_TOKEN",
  "FACEBOOK_APP_ID",
  "PUBLIC_BASE_URL",
  "FACEBOOK_APP_SECRET",
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required GitHub secret/variable values: ${missing.join(", ")}`);
}

const configPath = new URL("../wrangler.jsonc", import.meta.url);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

config.d1_databases = (config.d1_databases || []).map((database) =>
  database.binding === "DB"
    ? {
        ...database,
        database_id: process.env.D1_DATABASE_ID,
      }
    : database,
);

config.r2_buckets = (config.r2_buckets || []).map((bucket) =>
  bucket.binding === "UPLOADS"
    ? {
        ...bucket,
        bucket_name: process.env.R2_BUCKET_NAME || bucket.bucket_name,
      }
    : bucket,
);

config.vars = {
  ...(config.vars || {}),
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  GRAPH_API_VERSION: process.env.GRAPH_API_VERSION || "v25.0",
  FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
