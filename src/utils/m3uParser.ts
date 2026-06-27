/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { EnhancedChannel, RawChannelData } from '../types.ts';

/**
 * Parses raw .m3u / .m3u8 text into structured channel objects.
 */
export function parseM3U(text: string): EnhancedChannel[] {
  const lines = text.split(/\r?\n/);
  const channels: EnhancedChannel[] = [];
  let currentMeta: {
    tvgId?: string;
    tvgName?: string;
    tvgLogo?: string;
    groupTitle?: string;
    displayName?: string;
  } | null = null;

  let channelIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      // Parse #EXTINF attributes
      const meta: typeof currentMeta = {};

      // Extracts key-value attributes from the tag line
      // Handles both double quotes: key="val" and single quotes: key='val' or no quotes: key=val
      const regex = /([\w-]+)=["']?((?:.(?!["']?\s+(?:\w+)=|[>"']))+.)["']?/g;
      let match;
      const attrString = line.substring(line.indexOf(':') + 1);
      
      while ((match = regex.exec(attrString)) !== null) {
        const key = match[1].toLowerCase();
        const val = match[2];

        if (key === 'tvg-id' || key === 'tvgid') {
          meta.tvgId = val;
        } else if (key === 'tvg-name' || key === 'tvgname' || key === 'name') {
          meta.tvgName = val;
        } else if (key === 'tvg-logo' || key === 'tvglogo' || key === 'logo') {
          meta.tvgLogo = val;
        } else if (key === 'group-title' || key === 'grouptitle' || key === 'group') {
          meta.groupTitle = val;
        }
      }

      // Display name is typically at the end of the EXTINF line after the final comma
      const commaIndex = line.lastIndexOf(',');
      if (commaIndex !== -1) {
        meta.displayName = line.substring(commaIndex + 1).trim();
      }

      currentMeta = meta;
    } else if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('chrome-extension://')) {
      // If we have a URL, create a channel entry
      const name = currentMeta?.displayName || currentMeta?.tvgName || `Channel ${channelIdx + 1}`;
      const tvgId = currentMeta?.tvgId || `custom-ch-${channelIdx}`;
      const logoUrl = currentMeta?.tvgLogo || '';
      
      let rawGroup = currentMeta?.groupTitle || 'Custom';
      let normGroup = rawGroup.trim().toLowerCase();

      // Normalize common groups to match built-in system filters
      let category = normGroup;
      if (normGroup.includes('sport')) category = 'sports';
      else if (normGroup.includes('news')) category = 'news';
      else if (normGroup.includes('kid') || normGroup.includes('cartoon')) category = 'kids';
      else if (normGroup.includes('bangla')) category = 'bangla';
      else if (normGroup.includes('hindi')) category = 'hindi';
      else if (normGroup.includes('english')) category = 'english';
      else if (normGroup.includes('islamic') || normGroup.includes('muslim')) category = 'islamic';
      else if (normGroup.includes('sonatoni') || normGroup.includes('hindu')) category = 'sonatoni';
      else if (normGroup.includes('youtube')) category = 'youtube';

      channels.push({
        id: `custom-${tvgId}-${channelIdx}`,
        name: name,
        short: name.split(' ')[0] || 'Ch',
        url: line,
        category,
        logoUrl: logoUrl,
        groupTitle: rawGroup,
        original: {
          tvgId: tvgId,
          tvgName: name,
          tvgLogo: logoUrl,
          groupTitle: rawGroup,
          url: line
        }
      });

      channelIdx++;
      currentMeta = null; // Reset for next entries
    }
  }

  return channels;
}
