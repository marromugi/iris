import { sqlText } from "./invite";

/**
 * The SQL that gives the one user named `name` the mail tag `tag`, replacing the tag they had. It
 * changes nothing when no user, or more than one, has the name.
 */
export function mailTagUpdateStatement(name: string, tag: string): string {
  const named = `name = ${sqlText(name)}`;
  return `UPDATE users SET mail_tag = ${sqlText(tag)} WHERE ${named} AND (SELECT count(*) FROM users WHERE ${named}) = 1`;
}
