import { PullRequestComment } from './model/rhodecode';

/**
 * Parse the rendered RhodeCode pull request page and extract comment blocks.
 *
 * The page renders each comment as:
 *   <div class="comment ..." id="comment-<id>" data-comment-id="<id>">
 *     <div class="meta">
 *       <div class="author">  ... gravatar/user link ...  </div>
 *       <div class="date">    ...age string...            </div>
 *       <div class="changeset-status-lbl">Approved</div>  (optional)
 *     </div>
 *     <div class="text"> ... rendered comment ... </div>
 *   </div>
 */
export function parsePullRequestComments(html: string): PullRequestComment[] {
    const comments: PullRequestComment[] = [];

    // Locate every comment block by its data-comment-id attribute.
    const blockPattern = /<div[^>]*class="[^"]*\bcomment\b[^"]*"[^>]*data-comment-id="(\d+)"[^>]*>/g;
    let match: RegExpExecArray | null;
    while ((match = blockPattern.exec(html)) !== null) {
        const commentId = match[1];
        const openTag = match[0];
        const block = extractBalancedDiv(html, match.index);

        comments.push({
            commentId,
            author: extractAuthor(block),
            date: extractDate(block),
            statusChange: extractStatusChange(block),
            text: extractText(block),
            commentType: extractCommentType(openTag, block),
            resolved: extractResolved(block)
        });
    }

    // Fallback for servers that render without data-comment-id (older versions).
    if (comments.length === 0) {
        const fallbackPattern = /<div[^>]*class="[^"]*\bcomment\b[^"]*"[^>]*id="comment-(\d+)"[^>]*>/g;
        while ((match = fallbackPattern.exec(html)) !== null) {
            const block = extractBalancedDiv(html, match.index);
            comments.push({
                commentId: match[1],
                author: extractAuthor(block),
                date: extractDate(block),
                statusChange: extractStatusChange(block),
                text: extractText(block),
                commentType: extractCommentType(match[0], block),
                resolved: extractResolved(block)
            });
        }
    }

    return comments;
}

/**
 * TODO comments carry data-comment-type="todo" on the comment div
 * (modern UI) or a "comment-label todo" badge inside the block (older UI).
 */
function extractCommentType(openTag: string, block: string): 'todo' | 'note' | null {
    const attr = openTag.match(/data-comment-type="([^"]*)"/);
    if (attr) {
        return attr[1] === 'todo' ? 'todo' : 'note';
    }
    if (/comment-label\s+todo|comment-type-label[^>]*todo|class="[^"]*\btodo\b[^"]*"/.test(block)) {
        return 'todo';
    }
    return null;
}

/** A resolved task shows a `.resolved` marker inside the comment block. */
function extractResolved(block: string): boolean {
    return /class="[^"]*\bresolved\b[^"]*"/.test(block);
}

/**
 * Given an opening <div ...> at `start` (the index of the '<'), return the
 * full outer HTML of that div, correctly handling nested divs.
 */
function extractBalancedDiv(html: string, start: number): string {
    let depth = 0;
    const re = /<\/?div\b[^>]*>/gi;
    let tag: RegExpExecArray | null;
    while ((tag = re.exec(html)) !== null) {
        if (tag.index < start) {
            continue;
        }
        const isClosing = tag[0].startsWith('</');
        depth += isClosing ? -1 : 1;
        if (depth === 0) {
            const end = tag.index + tag[0].length;
            return html.slice(start, end);
        }
    }
    return html.slice(start);
}

function extractAuthor(block: string): string {
    const authorSection = block.match(/<div class="author">([\s\S]*?)<\/div>/);
    if (!authorSection) {
        return '';
    }
    const inner = authorSection[1];
    const imgAlt = inner.match(/<img[^>]*alt="([^"]*)"[^>]*>/);
    if (imgAlt && imgAlt[1].trim()) {
        return imgAlt[1].trim();
    }
    const link = inner.match(/<a[^>]*>([\s\S]*?)<\/a>/);
    if (link) {
        return stripTags(link[1]).trim();
    }
    return stripTags(inner).trim();
}

function extractDate(block: string): string {
    const dateSection = block.match(/<div class="date">([\s\S]*?)<\/div>/);
    if (!dateSection) {
        return '';
    }
    return stripTags(dateSection[1]).replace(/\s+/g, ' ').trim();
}

function extractStatusChange(block: string): string | null {
    const statusSection = block.match(/<div[^>]*class="[^"]*changeset-status-lbl[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!statusSection) {
        return null;
    }
    const value = stripTags(statusSection[1]).trim();
    return value || null;
}

function extractText(block: string): string {
    // The comment body lives in the last <div class="text"> ... </div>.
    const textSections = [...block.matchAll(/<div class="text">/g)];
    if (textSections.length === 0) {
        return '';
    }
    const last = textSections[textSections.length - 1];
    const body = extractBalancedDiv(block, last.index);
    return decodeEntities(stripTags(body)).replace(/\s+/g, ' ').trim();
}

function stripTags(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '');
}

function decodeEntities(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}
