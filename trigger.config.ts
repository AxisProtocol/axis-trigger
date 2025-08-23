export default {
  // Required in Trigger.dev v4: minimum 5 seconds
  maxDuration: 300,
  // Set your project ref via env: TRIGGER_PROJECT_REF=proj_XXXX
  project: process.env.TRIGGER_PROJECT_REF,
  // Help the CLI find your trigger files
  dirs: ["./triggers"],
  patterns: ["trigger.ts", "triggers/**/*.ts"]
};


