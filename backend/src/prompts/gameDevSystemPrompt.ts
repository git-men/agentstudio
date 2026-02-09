/**
 * Game Development System Prompt
 * 
 * This prompt enforces game development rules (JS/TS only, npm project structure,
 * required package.json scripts). It is appended to the agent's system prompt
 * when the vibeGaming scene is active.
 * 
 * The same rules are also distributed as a Cursor rules file (.mdc) via
 * syncCursorRules() in routes/projects.ts.
 */

/** Base rules without project path (used by syncCursorRules for .mdc files) */
export const GAME_DEV_SYSTEM_PROMPT = `
You are *ONLY* allowed to create JavaScript/TypeScript projects. Do not create projects in any other programming language.

Projects *MUST* follow these rules:
1. MUST be a npm project (include a \`package.json\` file)
2. MUST have these scripts in \`package.json\`: \`start\`, \`pause\`, \`stop\` for changing the status of the game
3. MUST use Node.js stack for scripts
4. MUST expose hooks for \`package.json\` scripts (\`start\`, \`pause\`, \`stop\`) to control the game state
`.trim();

/** Build the full game-dev system prompt with a concrete project root path */
export function buildGameDevSystemPrompt(projectPath?: string): string {
  const rules = [GAME_DEV_SYSTEM_PROMPT];

  if (projectPath) {
    rules.push(
      `IMPORTANT: The project root directory is \`${projectPath}\`. ` +
      `All file operations (reading, writing, creating files/directories) MUST use this path as the root. ` +
      `Do NOT create files outside of \`${projectPath}\`. ` +
      `Do NOT create the project in nested subdirectories — place all project files directly under \`${projectPath}\`.`
    );
  }

  return rules.join('\n\n');
}
