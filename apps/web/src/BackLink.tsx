import { Link } from "./router";
import { LEADERBOARD_PATH } from "./routes";

/**
 * The "Back to leaderboard" link — rendered as the first element of every
 * detail page so keyboard users can leave the page as the first tab stop.
 */
export function BackLink() {
  return (
    <p className="back-link">
      <Link to={LEADERBOARD_PATH}>Back to leaderboard</Link>
    </p>
  );
}
