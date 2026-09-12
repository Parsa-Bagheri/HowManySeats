import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLandmarkMovieTitle } from "./landmark-titles";

test("moves catalog-style trailing articles to the front", () => {
  assert.equal(
    normalizeLandmarkMovieTitle("Odyssey, The"),
    "The Odyssey",
  );
  assert.equal(
    normalizeLandmarkMovieTitle("Minecraft Movie, A"),
    "A Minecraft Movie",
  );
  assert.equal(
    normalizeLandmarkMovieTitle("Unexpected Story, An"),
    "An Unexpected Story",
  );
});

test("keeps punctuation and ordinary title wording intact", () => {
  assert.equal(
    normalizeLandmarkMovieTitle("Spider-Man: Across the Spider-Verse, The"),
    "The Spider-Man: Across the Spider-Verse",
  );
  assert.equal(
    normalizeLandmarkMovieTitle("Love, Actually"),
    "Love, Actually",
  );
  assert.equal(
    normalizeLandmarkMovieTitle("Mission: Impossible - Dead Reckoning"),
    "Mission: Impossible - Dead Reckoning",
  );
});

test("removes a matching IMAX suffix and normalizes the article", () => {
  assert.equal(
    normalizeLandmarkMovieTitle("Odyssey, The - IMAX Experience", ["IMAX"]),
    "The Odyssey",
  );
  assert.equal(
    normalizeLandmarkMovieTitle("Odyssey, The - The IMAX Experience", [
      { Name: "IMAX" },
    ]),
    "The Odyssey",
  );
});

test("handles catalog articles after a corroborated format suffix", () => {
  assert.equal(
    normalizeLandmarkMovieTitle(
      "End of Oak Street - The IMAX Experience, The",
      [{ Description: "IMAX" }],
    ),
    "The End of Oak Street",
  );
});

test("supports other exact Landmark format identities", () => {
  assert.equal(
    normalizeLandmarkMovieTitle("Avatar, The - D-BOX Experience", [
      "D BOX",
    ]),
    "The Avatar",
  );
  assert.equal(
    normalizeLandmarkMovieTitle("The New Movie - Recliner Seating", [
      { Name: "Recliner Seating" },
    ]),
    "The New Movie",
  );
  assert.equal(
    normalizeLandmarkMovieTitle("A Different Film - Dolby Cinema", [
      { Name: "Dolby Cinema" },
    ]),
    "A Different Film",
  );
});

test("uses either Name or Description as session experience metadata", () => {
  assert.equal(
    normalizeLandmarkMovieTitle("A Film - IMAX Experience", [
      { Description: "The IMAX Experience" },
    ]),
    "A Film",
  );
  assert.equal(
    normalizeLandmarkMovieTitle("A Film - IMAX Experience", [
      { Description: "The IMAX Experience, The" },
    ]),
    "A Film",
  );
  assert.equal(
    normalizeLandmarkMovieTitle("A Film - IMAX Experience", [
      { Name: "  imax  " },
    ]),
    "A Film",
  );
});

test("requires exact corroboration and preserves nonmatching suffixes", () => {
  const title = "Odyssey, The - IMAX Experience";

  assert.equal(
    normalizeLandmarkMovieTitle(title),
    "The Odyssey - IMAX Experience",
  );
  assert.equal(
    normalizeLandmarkMovieTitle(title, ["Regular"]),
    "The Odyssey - IMAX Experience",
  );
  assert.equal(
    normalizeLandmarkMovieTitle(title, ["IMAX with Laser"]),
    "The Odyssey - IMAX Experience",
  );
  assert.equal(
    normalizeLandmarkMovieTitle("A Film - IMAX with Laser Experience", [
      "IMAX",
    ]),
    "A Film - IMAX with Laser Experience",
  );
  assert.equal(
    normalizeLandmarkMovieTitle("End of Oak Street - IMAX Experience, The", [
      "Regular",
    ]),
    "The End of Oak Street - IMAX Experience",
  );
});

test("normalizes each session independently without changing showtime data", () => {
  const title = "Odyssey, The - IMAX Experience";
  const normalizedTitles = [
    normalizeLandmarkMovieTitle(title, ["IMAX"]),
    normalizeLandmarkMovieTitle(title, ["3D"]),
  ];

  assert.deepEqual(normalizedTitles, [
    "The Odyssey",
    "The Odyssey - IMAX Experience",
  ]);
});

test("returns empty output for empty title data", () => {
  assert.equal(normalizeLandmarkMovieTitle(undefined), "");
  assert.equal(normalizeLandmarkMovieTitle(null, []), "");
  assert.equal(normalizeLandmarkMovieTitle("   ", []), "");
});
