'use strict';

/**
 * Minimal, dependency-free multipart/form-data parser.
 *
 * Returns { fields: { name: value }, files: [{ field, filename, type, data }] }.
 * Repeated field names collect into an array so <select multiple> and repeated
 * inputs behave the way a form author expects.
 */

function boundaryOf(contentType) {
  if (!contentType) return null;
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) return null;
  return (m[1] || m[2]).trim();
}

function parseHeaders(block) {
  const headers = {};
  for (const line of block.split('\r\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    headers[line.slice(0, i).toLowerCase().trim()] = line.slice(i + 1).trim();
  }
  return headers;
}

function paramOf(value, key) {
  if (!value) return null;
  const m = new RegExp(`${key}=(?:"([^"]*)"|([^;]*))`, 'i').exec(value);
  if (!m) return null;
  return (m[1] ?? m[2] ?? '').trim();
}

function parse(buffer, contentType) {
  const boundary = boundaryOf(contentType);
  if (!boundary) throw new Error('Missing multipart boundary');

  const delimiter = Buffer.from(`\r\n--${boundary}`);
  // Prepending CRLF lets the very first delimiter match the same pattern as the rest.
  const body = Buffer.concat([Buffer.from('\r\n'), buffer]);

  const fields = Object.create(null);
  const files = [];

  let cursor = body.indexOf(delimiter);
  if (cursor < 0) throw new Error('Malformed multipart body');

  while (cursor >= 0) {
    let start = cursor + delimiter.length;
    if (body.slice(start, start + 2).toString() === '--') break; // closing delimiter
    if (body.slice(start, start + 2).toString() !== '\r\n') break; // not a well-formed part
    start += 2;

    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd < 0) break;

    const headers = parseHeaders(body.slice(start, headerEnd).toString('utf8'));
    const contentStart = headerEnd + 4;
    const next = body.indexOf(delimiter, contentStart);
    if (next < 0) break;

    const content = body.slice(contentStart, next);
    const disposition = headers['content-disposition'] || '';
    const name = paramOf(disposition, 'name');
    const filename = paramOf(disposition, 'filename');

    if (name) {
      if (filename !== null && filename !== undefined) {
        if (filename !== '' && content.length > 0) {
          files.push({
            field: name,
            filename,
            type: headers['content-type'] || 'application/octet-stream',
            data: content,
          });
        }
      } else {
        const value = content.toString('utf8');
        if (name in fields) {
          fields[name] = [].concat(fields[name], value);
        } else {
          fields[name] = value;
        }
      }
    }
    cursor = next;
  }

  return { fields, files };
}

module.exports = { parse, boundaryOf };
