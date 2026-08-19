# Issue: Enhanced comment thread display with threading and inline location highlighting

## Current State

PR comments are displayed flat with file names and line numbers shown separately:

```text
package.lock - <comment A>
.gitattributes - <comment B>

README.MD
line 55 - <comment 1>
line 129 - <comment 2>
```

## Desired State

### 1. Inline Comment Location Highlighting

PR-level comments that reference specific files/lines should be visually highlighted with the location information integrated into the comment display,
not shown as a separate line item.

**Example:**

```text
README.MD
  line 55 - <comment 1>
  line 129 - <comment 2>
```

### 2. Comment Threading (Replies)

Replies to comments should be:

- Indented under the parent comment
- Collapsible (like GitHub's PR review threads)
- Show basic info when collapsed: commenter, datetime, status, first ~50 chars of comment

**Example:**

```text
README.MD
  line 55 - <comment 1> [collapse ▼]
    Is this the right format?
      @user2: Yes, looks good! [collapse ▼]
    Let's update it
```

## Technical Requirements

1. **Location-based grouping**: Group comments by file path, showing file name as a parent item with comments indented underneath
2. **Thread hierarchy**: Track parent-child relationships between comments
3. **Collapse/expand state**: Maintain expand/collapse state for each comment thread
4. **Collapsed preview**: When collapsed, show:
   - Author name
   - Timestamp
   - Status (if applicable)
   - First ~50 characters of comment text
5. **Inline action buttons**: Reply button should be available on both expanded and collapsed views

## Files to Modify

- `src/comment_view_provider.ts` - Webview HTML structure and message handling
- `src/model/rhodecode.ts` - Extend comment interface if needed for thread info
- `src/comment_parser.ts` - Extract file path and line number from inline comments

## Acceptance Criteria

- [ ] File names displayed as collapsible headers with comments indented underneath
- [ ] Replies indented under parent comments
- [ ] Collapse/expand functionality for comment threads
- [ ] Collapsed view shows: author, datetime, status, comment preview
- [ ] Reply button available on collapsed comments
- [ ] Clicking file link jumps to correct line in editor
