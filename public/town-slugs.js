/** Must match server `TOWN_NAME_TO_SLUG` / creature town strings. */
export const TOWN_NAME_TO_SLUG = {
  Grimwhistle: "grimwhistle",
  "Skulldrip Hollow": "skulldrip-hollow",
  Spitebridge: "spitebridge",
  "Mucksnack-on-the-Mire": "mucksnack-on-the-mire",
};

export function slugForTownName(name) {
  const s = String(name || "").trim();
  return TOWN_NAME_TO_SLUG[s] || null;
}
