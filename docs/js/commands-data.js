/* Insomniacs Bot — command reference data
 * One entry per /ic subcommand. Keep in sync with src/commands/*.ts.
 *
 * requires: 'anyone' | 'link' (needs a linked FACEIT account) | 'admin' | 'owner'
 * visibility: who sees the bot's reply — 'everyone' or 'only-you'
 * params[].type: Text | Number | User | Channel | Choice
 */

window.IC_CATEGORIES = [
  { id: 'account',      label: 'Account' },
  { id: 'stats',        label: 'Player Stats' },
  { id: 'group',        label: 'Group Stats' },
  { id: 'maps',         label: 'Maps' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'utilities',    label: 'Utilities' },
];

window.IC_REQUIRES = {
  anyone: 'Anyone',
  link:   'Needs FACEIT link',
  admin:  'Admin options',
  owner:  'Bot owner only',
};

const USER_PARAM = {
  name: 'user', type: 'User', required: false, default: 'You',
  desc: 'The Discord user to look up. They need a linked FACEIT account.',
};

window.IC_COMMANDS = [
  // ── Account ───────────────────────────────────────────
  {
    name: 'link', category: 'account', requires: 'anyone', visibility: 'only-you', popular: true,
    synopsis: 'Link your Discord account to your FACEIT account.',
    description: 'Connects your Discord account to a FACEIT nickname so every stats command knows who you are. The bot checks the account exists and plays CS2, then stores its permanent FACEIT player ID — so changing your nickname later won\'t break the link. Each FACEIT account can only be linked to one Discord user.',
    params: [
      { name: 'faceit', type: 'Text', required: true, desc: 'Your FACEIT nickname. Not case-sensitive.' },
    ],
    examples: [
      { title: 'Link your account', cmd: '/ic link faceit:YourFaceitNickname', explain: 'Links you to that FACEIT account and shows your current ELO and level.' },
    ],
    output: 'A confirmation with your FACEIT nickname, ELO, level and avatar. If you\'re already linked, it tells you to run /ic unlink first.',
    related: ['unlink', 'linkstatus'],
  },
  {
    name: 'unlink', category: 'account', requires: 'anyone', visibility: 'only-you',
    synopsis: 'Remove your linked FACEIT account.',
    description: 'Deletes the link between your Discord account and FACEIT. Use it if you want to switch to a different FACEIT account — unlink, then run /ic link again.',
    params: [],
    examples: [
      { title: 'Remove your link', cmd: '/ic unlink', explain: 'Removes the link and confirms which FACEIT account it was.' },
    ],
    output: 'A confirmation naming the FACEIT account that was unlinked.',
    related: ['link', 'adminunlink'],
  },
  {
    name: 'linkstatus', category: 'account', requires: 'anyone', visibility: 'only-you',
    synopsis: 'Show the FACEIT account linked to a Discord user.',
    description: 'Shows which FACEIT account a Discord user is linked to, with their live ELO and level and when the link was made. Handy for checking you linked the right account.',
    params: [
      { ...USER_PARAM, desc: 'The Discord user to check.' },
    ],
    examples: [
      { title: 'Check your own link', cmd: '/ic linkstatus', explain: 'Shows your linked FACEIT account.' },
      { title: 'Check someone else', cmd: '/ic linkstatus user:@Adam', explain: 'Shows which FACEIT account Adam is linked to.' },
    ],
    output: 'FACEIT nickname, current ELO, level and how long ago the link was made.',
    related: ['link'],
  },
  {
    name: 'adminunlink', category: 'account', requires: 'owner', visibility: 'only-you',
    synopsis: 'Remove another user\'s linked FACEIT account.',
    description: 'Lets the bot owner remove someone else\'s FACEIT link — for example if they linked the wrong account and have left the server.',
    params: [
      { name: 'user', type: 'User', required: true, desc: 'The Discord user to unlink.' },
    ],
    examples: [
      { title: 'Unlink a user', cmd: '/ic adminunlink user:@Adam', explain: 'Removes Adam\'s FACEIT link.' },
    ],
    output: 'A confirmation naming the FACEIT account that was removed, or a "permission denied" message for anyone except the bot owner.',
    related: ['unlink'],
  },

  // ── Player stats ──────────────────────────────────────
  {
    name: 'stats', category: 'stats', requires: 'link', visibility: 'everyone', popular: true,
    synopsis: 'View FACEIT CS2 statistics, lifetime or for a recent period.',
    description: 'Your headline FACEIT numbers. By default it shows lifetime stats — ELO, level, region, matches, win rate, K/D, headshot %, current and best win streak, and your last 5 results. Pick a period to see the same numbers for just the last week, month or three months, including your ELO change over that time.',
    params: [
      USER_PARAM,
      { name: 'period', type: 'Choice', required: false, default: 'Lifetime', values: ['Last 7 days', 'Last 30 days', 'Last 3 months'], desc: 'Only count matches from this period.' },
    ],
    examples: [
      { title: 'Your lifetime stats', cmd: '/ic stats', explain: 'Shows your all-time FACEIT stats.' },
      { title: 'Someone else\'s stats', cmd: '/ic stats user:@Adam', explain: 'Shows Adam\'s lifetime stats.' },
      { title: 'Just this month', cmd: '/ic stats period:Last 30 days', explain: 'Shows matches, record, win rate, K/D, kills, HS% and ELO change over the last 30 days.' },
    ],
    output: 'An embed with ELO, level, win rate, K/D, headshot %, streaks and recent form.',
    related: ['form', 'last', 'compare'],
  },
  {
    name: 'recent', category: 'stats', requires: 'link', visibility: 'everyone', popular: true,
    synopsis: 'List recent FACEIT CS2 matches.',
    description: 'A compact table of your most recent matches showing result, map, score, kills and K/D for each.',
    params: [
      USER_PARAM,
      { name: 'count', type: 'Number', required: false, default: '10', values: ['1 – 20'], desc: 'How many matches to show.' },
    ],
    examples: [
      { title: 'Your last 10 matches', cmd: '/ic recent', explain: 'Shows your 10 most recent matches.' },
      { title: 'More matches', cmd: '/ic recent count:20', explain: 'Shows your last 20 matches.' },
      { title: 'Someone else', cmd: '/ic recent user:@Adam', explain: 'Shows Adam\'s recent matches.' },
    ],
    output: 'A table: W/L, map, score, kills and K/D per match.',
    related: ['last', 'session', 'form'],
  },
  {
    name: 'last', category: 'stats', requires: 'link', visibility: 'everyone', popular: true,
    synopsis: 'Show detailed stats from the most recent FACEIT match.',
    description: 'Everything about your last match in one place — map, score, result, kills, deaths, assists, K/D, headshot %, ELO change and any aces — with a link to the match on FACEIT.',
    params: [USER_PARAM],
    examples: [
      { title: 'Your last match', cmd: '/ic last', explain: 'Shows your most recent match in detail.' },
      { title: 'Someone else\'s last match', cmd: '/ic last user:@Adam', explain: 'Shows Adam\'s most recent match.' },
    ],
    output: 'An embed with the full scoreline for that match and a "View on FACEIT" link.',
    related: ['recent', 'session'],
  },
  {
    name: 'form', category: 'stats', requires: 'link', visibility: 'everyone',
    synopsis: 'Aggregated performance summary over recent matches.',
    description: 'How you\'ve been playing lately. Averages your recent matches into a single summary — record, win rate, average kills, deaths, K/D and HS%, your best and worst game, your last 5 results and the maps you\'ve played most.',
    params: [
      USER_PARAM,
      { name: 'matches', type: 'Number', required: false, default: '20', values: ['5 – 40'], desc: 'How many recent matches to analyse.' },
    ],
    examples: [
      { title: 'Your current form', cmd: '/ic form', explain: 'Summarises your last 20 matches.' },
      { title: 'A longer window', cmd: '/ic form matches:40', explain: 'Summarises your last 40 matches.' },
      { title: 'Someone else', cmd: '/ic form user:@Adam', explain: 'Summarises Adam\'s recent form.' },
    ],
    output: 'An embed with averages, best/worst game, last-5 results and a map breakdown.',
    related: ['stats', 'session'],
  },
  {
    name: 'session', category: 'stats', requires: 'link', visibility: 'everyone',
    synopsis: 'Stats from the most recent play session.',
    description: 'Groups your latest matches into a session — a run of games with no gap longer than 3 hours — and summarises it: games, W/L, K/D, HS%, best game, maps played, start and end time, and ELO change where available. Perfect for "how did tonight go?".',
    params: [USER_PARAM],
    examples: [
      { title: 'Tonight\'s session', cmd: '/ic session', explain: 'Summarises your most recent session.' },
      { title: 'Someone else', cmd: '/ic session user:@Adam', explain: 'Summarises Adam\'s most recent session.' },
    ],
    output: 'An embed with the session record, averages, best game, maps and time range.',
    related: ['last', 'form'],
  },

  // ── Group stats ───────────────────────────────────────
  {
    name: 'leaderboard', category: 'group', requires: 'anyone', visibility: 'everyone', popular: true,
    synopsis: 'Ranked leaderboard of every linked player.',
    description: 'Ranks everyone who has linked a FACEIT account. Use the dropdown under the message to switch category without running the command again.',
    params: [],
    examples: [
      { title: 'Show the leaderboard', cmd: '/ic leaderboard', explain: 'Shows the ELO leaderboard; pick another category from the menu.' },
    ],
    output: 'A ranked list with a dropdown for: ELO, K/D Ratio, Win Rate, Headshots %, Matches Played and Best Win Streak.',
    related: ['records', 'compare'],
  },
  {
    name: 'compare', category: 'group', requires: 'link', visibility: 'everyone',
    synopsis: 'Head-to-head stats comparison between two linked players.',
    description: 'Puts two players\' lifetime stats side by side so you can settle the argument.',
    params: [
      { name: 'player1', type: 'User', required: true, desc: 'The first player. Must have a linked FACEIT account.' },
      { name: 'player2', type: 'User', required: true, desc: 'The second player. Must have a linked FACEIT account.' },
    ],
    examples: [
      { title: 'Compare two players', cmd: '/ic compare player1:@Adam player2:@Dave', explain: 'Shows Adam and Dave\'s stats side by side.' },
    ],
    output: 'A three-column embed: stat names, player 1, player 2.',
    related: ['stats', 'leaderboard'],
  },
  {
    name: 'records', category: 'group', requires: 'anyone', visibility: 'everyone',
    synopsis: 'The all-time Insomniacs record book.',
    description: 'Who holds the group records across all linked players — highest ELO, best K/D, best win rate, longest win streak, most matches and best single-game kill count.',
    params: [],
    examples: [
      { title: 'Show the record book', cmd: '/ic records', explain: 'Lists each record and who holds it.' },
    ],
    output: 'An embed with each record, the holder and their number.',
    related: ['leaderboard', 'achievements'],
  },
  {
    name: 'chemistry', category: 'group', requires: 'link', visibility: 'everyone',
    synopsis: 'Duo win rates with other linked players.',
    description: 'Looks at your last 100 matches and works out how you do with each linked teammate. Shows your best duo, worst duo and most-played-with partner, plus a full teammate table. Duos with fewer than 10 shared games are marked as a small sample.',
    params: [USER_PARAM],
    examples: [
      { title: 'Your chemistry', cmd: '/ic chemistry', explain: 'Shows your win rate with each teammate.' },
      { title: 'Someone else', cmd: '/ic chemistry user:@Adam', explain: 'Shows Adam\'s teammate chemistry.' },
    ],
    output: 'Best duo, worst duo, most played with, and a table of games and win rate per teammate.',
    related: ['compare'],
  },

  // ── Maps ──────────────────────────────────────────────
  {
    name: 'maps', category: 'maps', requires: 'link', visibility: 'everyone',
    synopsis: 'Per-map win rate and K/D breakdown.',
    description: 'A table of every map you\'ve played in your last 50 matches with games, wins, losses, win rate and K/D — find your best and worst maps at a glance.',
    params: [USER_PARAM],
    examples: [
      { title: 'Your map pool', cmd: '/ic maps', explain: 'Shows your per-map breakdown.' },
      { title: 'Someone else', cmd: '/ic maps user:@Adam', explain: 'Shows Adam\'s map breakdown.' },
    ],
    output: 'A table: map, games, W/L, win rate, K/D.',
    related: ['mapstats'],
  },
  {
    name: 'mapstats', category: 'maps', requires: 'link', visibility: 'everyone',
    synopsis: 'Detailed statistics for one map.',
    description: 'Drills into a single map using your last 100 matches — games, record, win rate, average kills, deaths, K/D and HS%, and your best game on it.',
    params: [
      { name: 'map', type: 'Text', required: true, desc: 'The map name, e.g. Mirage, Inferno, Dust2, Ancient.' },
      USER_PARAM,
    ],
    examples: [
      { title: 'Your Mirage stats', cmd: '/ic mapstats map:Mirage', explain: 'Shows your stats on Mirage.' },
      { title: 'Someone else on Ancient', cmd: '/ic mapstats map:Ancient user:@Adam', explain: 'Shows Adam\'s stats on Ancient.' },
    ],
    output: 'An embed with record, win rate, averages and best game for that map.',
    related: ['maps'],
  },

  // ── Achievements ──────────────────────────────────────
  {
    name: 'achievements', category: 'achievements', requires: 'link', visibility: 'everyone',
    synopsis: 'Achievements earned from your match history.',
    description: 'Badges worked out from your FACEIT history whenever you ask — never announced. Includes Century Club and Veteran (100 / 500 matches), On Fire and Unstoppable (win streaks), Tilt Queue (5-game loss streak), Go To Bed and The Insomniac (late-night matches, 11pm – 5am), Thirty Bomb and Thirty-Five?! (30+ / 35+ kill games), The Hard Carry (30 kills in a loss) and Ace.',
    params: [USER_PARAM],
    examples: [
      { title: 'Your achievements', cmd: '/ic achievements', explain: 'Lists the achievements you\'ve earned.' },
      { title: 'Someone else', cmd: '/ic achievements user:@Adam', explain: 'Lists Adam\'s achievements.' },
    ],
    output: 'A list of earned achievements, each with the stat that earned it.',
    related: ['records'],
  },

  // ── Utilities ─────────────────────────────────────────
  {
    name: 'birthday', category: 'utilities', requires: 'admin', visibility: 'everyone', popular: true,
    synopsis: 'Save birthdays — the bot posts a reminder a week before and a message on the day.',
    description: 'Save your birthday and the bot will post in the server\'s birthday channel at 9am UK time: a heads-up one week before (names shown, no ping), then a happy birthday on the day (with a ping). Birthdays are saved per server and only the day and month are stored. An admin needs to choose the birthday channel first. Anyone with Manage Server can also set or remove birthdays for other people. 29 February birthdays are celebrated on 28 February in non-leap years.',
    params: [
      { name: 'action', type: 'Choice', required: true, values: ['set', 'remove', 'list', 'channel'], desc: 'What to do. set saves a birthday, remove deletes one, list shows upcoming birthdays, channel (admin) picks where messages are posted.' },
      { name: 'day', type: 'Number', required: false, values: ['1 – 31'], desc: 'Day of the month. Needed for set.' },
      { name: 'month', type: 'Choice', required: false, values: ['January – December'], desc: 'Month. Needed for set.' },
      { name: 'user', type: 'User', required: false, default: 'You', desc: 'Admin only: set or remove someone else\'s birthday.' },
      { name: 'channel', type: 'Channel', required: false, desc: 'Admin only, for channel: where birthday messages go. Leave empty to turn birthday messages off.' },
    ],
    examples: [
      { title: 'Save your birthday', cmd: '/ic birthday action:set day:14 month:March', explain: 'Saves your birthday as 14th March.' },
      { title: 'See upcoming birthdays', cmd: '/ic birthday action:list', explain: 'Lists everyone\'s birthday in this server, soonest first.' },
      { title: 'Remove your birthday', cmd: '/ic birthday action:remove', explain: 'Deletes your birthday from this server.' },
      { title: 'Set someone else\'s birthday (admin)', cmd: '/ic birthday action:set day:2 month:July user:@friend', explain: 'Saves a birthday for another member. Needs Manage Server.' },
      { title: 'Choose the birthday channel (admin)', cmd: '/ic birthday action:channel channel:#general', explain: 'Birthday messages will be posted in #general. Run it with no channel to turn them off.' },
    ],
    output: 'set, remove and channel reply privately. list is posted for everyone but doesn\'t ping anyone. Scheduled messages: "📅 Heads up — @Dave\'s birthday is in a week, on Wednesday 18th November! 🎂" and "🎉🎂 Happy birthday @Dave! Have a great day! 🎂🎉".',
    related: ['poll'],
  },
  {
    name: 'poll', category: 'utilities', requires: 'anyone', visibility: 'everyone', popular: true,
    synopsis: 'Create a poll with up to 5 options.',
    description: 'Posts a poll with numbered emoji reactions for voting. It closes after the duration you set, and only the person who created it can end it early with the End Poll button, which shows the final vote counts.',
    params: [
      { name: 'question', type: 'Text', required: true, values: ['Up to 300 characters'], desc: 'The poll question.' },
      { name: 'option1', type: 'Text', required: true, values: ['Up to 100 characters'], desc: 'First option.' },
      { name: 'option2', type: 'Text', required: true, values: ['Up to 100 characters'], desc: 'Second option.' },
      { name: 'option3', type: 'Text', required: false, values: ['Up to 100 characters'], desc: 'Third option.' },
      { name: 'option4', type: 'Text', required: false, values: ['Up to 100 characters'], desc: 'Fourth option.' },
      { name: 'option5', type: 'Text', required: false, values: ['Up to 100 characters'], desc: 'Fifth option.' },
      { name: 'duration', type: 'Number', required: false, default: '24', values: ['1 – 168 hours'], desc: 'How long the poll stays open, in hours.' },
    ],
    examples: [
      { title: 'A quick two-option poll', cmd: '/ic poll question:Best map? option1:Mirage option2:Inferno', explain: 'Posts a 24-hour poll with two options.' },
      { title: 'A longer poll', cmd: '/ic poll question:When are we playing? option1:Tonight option2:Tomorrow option3:Weekend duration:48', explain: 'Posts a three-option poll that runs for 48 hours.' },
    ],
    output: 'A poll embed with emoji reactions, a close time and an End Poll button.',
    related: ['birthday'],
  },
  {
    name: 'ping', category: 'utilities', requires: 'anyone', visibility: 'everyone',
    synopsis: 'Check bot status and latency.',
    description: 'Checks the bot is online and shows how quickly it\'s responding.',
    params: [],
    examples: [
      { title: 'Check the bot', cmd: '/ic ping', explain: 'Replies with round-trip and WebSocket latency.' },
    ],
    output: 'Round-trip time and WebSocket ping in milliseconds.',
    related: ['info'],
  },
  {
    name: 'info', category: 'utilities', requires: 'anyone', visibility: 'everyone',
    synopsis: 'Show bot info and links.',
    description: 'Shows a short intro to the bot with links to this website, the full command list and the feature request page.',
    params: [],
    examples: [
      { title: 'Show bot info', cmd: '/ic info', explain: 'Posts the bot info card with links.' },
    ],
    output: 'An embed with links to the website, commands and feature requests.',
    related: ['ping'],
  },
];
