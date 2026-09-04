# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People and teams who manage email, calendars, contacts, and related work from a desktop mail client.

## Product Purpose

SummerMail is a desktop email application for reading, organizing, searching, composing, and synchronizing mail alongside calendar and contact workflows. Success means dependable daily communication with fast local interaction and provider-backed synchronization.

## Positioning

SummerMail combines an extensible Electron and React desktop interface with a local native synchronization engine and plugin architecture.

## Operating Context

The product is used as a daily desktop workspace across Windows, macOS, and Linux. It supports multiple mail accounts, unified inbox workflows, search, snooze, send later, rules, templates, contacts, and calendars.

## Capabilities and Constraints

- Preserve existing product behavior, platform support, accessibility work, user profiles, and protocol integrations while moving the complete product identity to SummerMail.
- Product-owned package names, module imports, CSS hooks, profile directories, protocol schemes, bundle IDs, executables, installers, and build artifacts use `summermail` or `SummerMail`.
- Existing profiles and third-party plugins receive narrow compatibility bridges during migration.
- A new application icon is explicitly deferred to a later pass; existing image content may remain temporarily under SummerMail filenames.

## Brand Commitments

- Product name: SummerMail.
- This rebrand preserves the current visual design while replacing both visible and technical product naming.
- Existing iconography remains in place temporarily until a focused icon design pass.

## Evidence on Hand

- Existing production interface, packaging resources, localization strings, and application assets in this repository.
- Existing screenshots and visual regression snapshots document the current interface.
- No new icon or broader visual identity has been approved yet.

## Product Principles

- Keep daily mail workflows fast and dependable.
- Preserve user data and compatibility across upgrades.
- Keep the interface extensible through established plugin and theme systems.
- Make product identity consistent anywhere users encounter the application name.

## Accessibility & Inclusion

Preserve the repository's existing semantic, keyboard, focus, labeling, and localization conventions across renamed user-facing copy.
