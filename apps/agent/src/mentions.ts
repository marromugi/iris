/**
 * Which members reply to a post: those named in it with @ and their name, in the order they are
 * named, or every member when none is. Where one member's name begins another's, the longer name
 * that the text has after the @ is the one meant.
 */
export function repliers(
  text: string,
  members: readonly { readonly id: string; readonly name: string }[],
): string[] {
  const longestFirst = members.toSorted((a, b) => b.name.length - a.name.length);
  const named: string[] = [];
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    const member = longestFirst.find(
      (each) => each.name.length > 0 && text.startsWith(each.name, at + 1),
    );
    if (member !== undefined && !named.includes(member.id)) {
      named.push(member.id);
    }
  }
  return named.length > 0 ? named : members.map((member) => member.id);
}
