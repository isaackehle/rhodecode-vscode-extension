# Message Display Feature Implementation Plan

## Overview

Implement a full messaging system that allows users to add new messages to an open PR by clicking on a line in a file, then adding a message.
The system will also allow users to respond to existing messages and mark TODO comments as complete.

## Current State

- `CommentViewProvider` shows all comments on a PR in a webview panel
- Users can reply, add tasks, resolve tasks, and mark comments as handled
- Comments are fetched via `client.getPullRequestComments()` (modern API) or HTML parsing (fallback)
- No inline line-based commenting exists yet

## Implementation Plan

### Phase 1: Add Commands and Menu Items

1. Add new command `rhodecode.addMessage` for inline commenting
2. Add menu item in file editor context menu for "Add RhodeCode Message"
3. Add command to show existing messages in a tree view or webview

### Phase 2: Implement Inline Comment Creation

1. Add command handler that:
   - Gets current editor selection (line number)
   - Gets file path from active editor
   - Opens input box for message text
   - Calls `client.addCommentOnLine()` API

### Phase 3: Display Messages in Tree View

1. Add a new tree view for PR messages (or integrate into existing PR tree)
2. Display messages grouped by PR
3. Show message type (NOTE vs TODO), line number, author, status

### Phase 4: Add Response and Mark Complete Features

1. Add ability to reply to existing messages
2. Add checkbox to mark TODO as complete
3. Update existing comment handling for TODO resolution

### Phase 5: API Integration

1. Verify RhodeCode API supports line-based comments
2. If not, use existing comment API with file path + line number in message text
3. Test with actual RhodeCode server

## Files to Modify

- `src/commands.ts` - Add new commands and handlers
- `src/rhodecoderequest.ts` - Add `addCommentOnLine()` method if needed
- `src/pullRequestTreeProvider.ts` - Add message tree view or update existing view
- `src/model/rhodecode.ts` - Add message-related interfaces if needed
- `package.json` - Register new commands and menu items

## API Requirements

RhodeCode's `add_comment` API typically supports:

- `pull_request_id`
- `comment_text`
- Optional: `f_path` (file path), `lineno` (line number)

Need to verify exact API signature.

## Success Criteria

- User can click on a line in a file editor
- User can add a NOTE or TODO comment to that line
- Comments appear in the PR comments view with line number metadata
- User can reply to comments
- User can mark TODO comments as resolved

## Testing

- Test with modern RhodeCode API (4.6+)
- Test fallback HTML parsing for older servers
- Verify line numbers are displayed correctly
- Test reply and resolve functionality
