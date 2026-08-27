// @ts-check

/**
 * Host-neutral dispatch skill resolution: Jeff-owned mandatory skills versus
 * an optional matching language skill (host, then repository, then installed).
 *
 * @param {{
 *   mandatory: { name: string, path: string }[],
 *   languageName: string | null,
 *   sources: {
 *     host: { name: string, path: string }[],
 *     repo: { name: string, path: string }[],
 *     installed: { name: string, path: string }[],
 *   },
 *   exists: (path: string) => boolean,
 * }} input
 * @returns {{
 *   claimed: string[],
 *   languagePath: string | null,
 *   failClosed: boolean,
 *   missingClaimed: string[],
 * }}
 */
export function resolveDispatchSkills(input) {
  const claimed = input.mandatory.map((skill) => skill.path);
  let languagePath = null;
  if (input.languageName) {
    for (const group of [input.sources.host, input.sources.repo, input.sources.installed]) {
      const match = group.find((skill) => skill.name === input.languageName && input.exists(skill.path));
      if (match) {
        languagePath = match.path;
        claimed.push(languagePath);
        break;
      }
    }
  }
  const missingClaimed = claimed.filter((path) => !input.exists(path));
  return {
    claimed,
    languagePath,
    failClosed: missingClaimed.length > 0,
    missingClaimed,
  };
}
