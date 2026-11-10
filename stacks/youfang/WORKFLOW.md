# Youfang's day with MiniMax Code

> **Draft.** Written from how the agent and I build talk decks today; I will
> rewrite it in my own words.

Most of my work with the agent is server-side engineering across several
repositories. Every few weeks part of that work has to be explained to other
people: an architecture review, a design walkthrough, a team share. That is
where `magic-move-deck` comes in.

## Slides are diagrams seen through a camera

I don't ask the agent for bullet slides. A deck is one overview diagram plus
one detail diagram per topic, and every slide is a camera framing on one of
them. Moving between slides, the boxes and titles both slides share morph to
their new place, so the audience never loses track of where a detail lives.
The storyline is fixed: cover, overview, then for each topic "zoom into its
region, show its detail diagram, spotlight three things", back to the
overview, closing card. Each spotlight carries one sentence it has to prove;
a spotlight without a conclusion gets cut.

## Plan in text first

Before anything is drawn, the agent writes the storyline as a list: the deck
title, each topic's one-line principle, the three conclusions per topic, which
concepts appear on the overview and which only in a detail diagram. I correct
that list, not the drawings. The agent also locks each concept to a colour
role in a binding table, so the same concept looks the same on every slide.

## Pick the look from real samples

The agent draws one representative detail diagram with the real content,
then renders it in all four styles (hand-drawn, minimal, dark neon,
neo-brutalist) and shows me the four images. I pick one; nothing else is
drawn until I do. Because every style template exposes the same helpers, the
choice costs nothing to change later.

## Review screenshots, not claims

"The deck builds" is not done. The agent screenshots every slide and freezes
the overview ↔ detail transitions at several points in both directions, then
looks for text running into text, boxes that should have flown but faded
(names that did not match), and spotlights that crop their conclusion. It
fixes the diagram, never the engine, to make one slide look right. I review
those screenshots before I open the deck myself.

## What stays with me

Which story to tell, the final wording of every conclusion, and anything
that names an internal system. Decks are written with generic names so they
can be shared outside the team; publishing or hosting a deck is my call.

| Moment | Skill |
| --- | --- |
| A design or architecture needs to be presented | `magic-move-deck` |
