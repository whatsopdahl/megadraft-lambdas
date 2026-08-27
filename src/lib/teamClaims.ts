import type { AuthenticatedUser } from "./auth.js";
import type { FantasyTeam } from "./types.js";

/**
 * Auto-claims any team whose invited email matches this user's login email
 * and isn't already claimed. This is the whole membership model - a
 * commissioner invites by email, and logging in with that email is the join.
 */
export function claimTeamsByEmail(
  teams: FantasyTeam[],
  user: AuthenticatedUser,
): { teams: FantasyTeam[]; changed: boolean } {
  if (!user.email) {
    return { teams, changed: false };
  }

  let changed = false;
  const claimed = teams.map((team) => {
    if (!team.ownerUserId && team.email.toLowerCase() === user.email!.toLowerCase()) {
      changed = true;
      return { ...team, ownerUserId: user.userId };
    }
    return team;
  });

  return { teams: claimed, changed };
}
