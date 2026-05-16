import { SubtitleCue } from '../types';

function parseTime(timeStr: string): number {
  const parts = timeStr.split(':');
  let seconds = 0;
  if (parts.length === 3) {
    // hh:mm:ss.mss
    seconds += parseInt(parts[0], 10) * 3600;
    seconds += parseInt(parts[1], 10) * 60;
    seconds += parseFloat(parts[2]);
  } else if (parts.length === 2) {
    // mm:ss.mss
    seconds += parseInt(parts[0], 10) * 60;
    seconds += parseFloat(parts[1]);
  }
  return seconds;
}

export async function parseVTT(file: File): Promise<SubtitleCue[]> {
  const text = await file.text();
  const lines = text.split(/\r?\n/);
  
  const cues: SubtitleCue[] = [];
  let currentCue: Partial<SubtitleCue> | null = null;
  let textLines: string[] = [];
  let idCounter = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines or WEBVTT header
    if (!line || line.startsWith('WEBVTT')) {
      if (currentCue && currentCue.startTime !== undefined) {
        currentCue.text = textLines.join('\n');
        cues.push(currentCue as SubtitleCue);
        currentCue = null;
        textLines = [];
      }
      continue;
    }

    // Check for timestamp line
    if (line.includes('-->')) {
      const [startStr, endStr] = line.split('-->').map(s => s.trim());
      
      // If we already had a cue building but no empty line separated them, push it
      if (currentCue && currentCue.startTime !== undefined) {
        currentCue.text = textLines.join('\n');
        cues.push(currentCue as SubtitleCue);
        textLines = [];
      }

      currentCue = {
        id: `cue-${idCounter++}`,
        startTime: parseTime(startStr),
        endTime: parseTime(endStr)
      };
    } else if (currentCue) {
      // It's text for the current cue
      textLines.push(line);
    }
  }

  // Push the last cue if exists
  if (currentCue && currentCue.startTime !== undefined) {
    currentCue.text = textLines.join('\n');
    cues.push(currentCue as SubtitleCue);
  }

  return cues;
}
