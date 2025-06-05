import { MCPTool } from './mcp-client';

export interface StandardizedEvent {
  id: string;
  title: string;
  start: Date | string; // Allow both Date objects and ISO strings for serialization
  end: Date | string;   // Allow both Date objects and ISO strings for serialization
  description?: string;
  location?: string;
  allDay: boolean;
  timezone?: string;
}

export interface EventFormatterArgs {
  events: Array<{
    title: string;
    start: string | Date; // Flexible input - ISO string, Date object, or various formats
    end?: string | Date;  // Optional - will default to start + 1 hour if not provided
    description?: string;
    location?: string;
    allDay?: boolean;
    timezone?: string;
    duration?: string;    // Alternative to end time, e.g., "2h", "30m", "1d"
  }>;
  defaultTimezone?: string;
  defaultDuration?: string; // Default duration if end time not provided
}

/**
 * Event formatter tool that normalizes various event input formats into a standardized structure
 */
export class EventFormatter {
  
  /**
   * Parse various date string formats into a Date object
   */
  private parseDate(dateInput: string | Date, timezone?: string): Date {
    if (dateInput instanceof Date) {
      return dateInput;
    }

    const dateStr = dateInput.toString();
    
    // Handle ISO 8601 format
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
      return new Date(dateStr);
    }
    
    // Handle date-only format (YYYY-MM-DD)
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return new Date(dateStr + 'T00:00:00');
    }
    
    // Handle natural language dates with time
    if (dateStr.match(/\d{1,2}:\d{2}/) && dateStr.match(/\d{4}-\d{2}-\d{2}/)) {
      return new Date(dateStr);
    }
    
    // Handle MM/DD/YYYY format
    if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
      return new Date(dateStr);
    }
    
    // Handle human-readable formats like "December 25, 2024 at 2:00 PM"
    const humanReadable = dateStr.match(/(\w+\s+\d{1,2},?\s+\d{4})(?:\s+at\s+(\d{1,2}:\d{2}\s*[AP]M))?/i);
    if (humanReadable) {
      const datePart = humanReadable[1];
      const timePart = humanReadable[2] || '12:00 AM';
      return new Date(`${datePart} ${timePart}`);
    }
    
    // Fallback to Date constructor
    try {
      return new Date(dateStr);
    } catch (error) {
      throw new Error(`Unable to parse date: ${dateStr}`);
    }
  }

  /**
   * Parse duration string (e.g., "2h", "30m", "1d") into milliseconds
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+(?:\.\d+)?)\s*([dhm])$/i);
    if (!match) {
      throw new Error(`Invalid duration format: ${duration}. Use format like "2h", "30m", "1d"`);
    }
    
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    
    switch (unit) {
      case 'd': return value * 24 * 60 * 60 * 1000; // days
      case 'h': return value * 60 * 60 * 1000;      // hours
      case 'm': return value * 60 * 1000;           // minutes
      default: throw new Error(`Unsupported duration unit: ${unit}`);
    }
  }

  /**
   * Generate a unique ID for an event
   */
  private generateEventId(event: any, index: number): string {
    const titleHash = event.title.replace(/\s+/g, '-').toLowerCase().substring(0, 20);
    const dateHash = event.start.toString().substring(0, 10);
    return `${titleHash}-${dateHash}-${index}`;
  }

  /**
   * Format and normalize events into standardized structure
   */
  async formatEvents(args: EventFormatterArgs): Promise<{ events: StandardizedEvent[] }> {
    const standardizedEvents: StandardizedEvent[] = [];
    
    for (let i = 0; i < args.events.length; i++) {
      const event = args.events[i];
      
      try {
        // Parse start date
        const startDate = this.parseDate(event.start, event.timezone || args.defaultTimezone);
        
        // Determine if it's an all-day event
        const isAllDay = Boolean(event.allDay || 
          (typeof event.start === 'string' && event.start.match(/^\d{4}-\d{2}-\d{2}$/) && !event.end));
        
        // Calculate end date
        let endDate: Date;
        
        if (event.end) {
          endDate = this.parseDate(event.end, event.timezone || args.defaultTimezone);
        } else if (event.duration) {
          const durationMs = this.parseDuration(event.duration);
          endDate = new Date(startDate.getTime() + durationMs);
        } else if (isAllDay) {
          // All-day events end at the start of the next day
          endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
        } else {
          // Default to 1 hour duration
          const defaultDurationMs = args.defaultDuration 
            ? this.parseDuration(args.defaultDuration)
            : 60 * 60 * 1000; // 1 hour
          endDate = new Date(startDate.getTime() + defaultDurationMs);
        }
        
        // Validate that end is after start
        if (endDate <= startDate) {
          throw new Error(`End time must be after start time for event: ${event.title}`);
        }
        
        const standardizedEvent: StandardizedEvent = {
          id: this.generateEventId(event, i),
          title: event.title.trim(),
          start: startDate,
          end: endDate,
          description: event.description?.trim(),
          location: event.location?.trim(),
          allDay: isAllDay,
          timezone: event.timezone || args.defaultTimezone
        };
        
        standardizedEvents.push(standardizedEvent);
        
      } catch (error) {
        throw new Error(`Error processing event "${event.title}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Sort events by start time
    standardizedEvents.sort((a, b) => {
      const aTime = a.start instanceof Date ? a.start.getTime() : new Date(a.start).getTime();
      const bTime = b.start instanceof Date ? b.start.getTime() : new Date(b.start).getTime();
      return aTime - bTime;
    });
    
    return { events: standardizedEvents };
  }

  /**
   * Get MCP tool definition
   */
  static getToolDefinition(): MCPTool {
    return {
      name: 'Calendar_FormatEvents',
      description: 'Normalizes and standardizes event data from various sources into a consistent format for calendar generation',
      inputSchema: {
        type: 'object',
        properties: {
          events: {
            type: 'array',
            description: 'Array of event objects to format and normalize',
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Event title/name'
                },
                start: {
                  type: 'string',
                  description: 'Start date/time in ISO format, date-only (YYYY-MM-DD), or human-readable format'
                },
                end: {
                  type: 'string',
                  description: 'Optional end date/time. If not provided, duration or default duration will be used'
                },
                description: {
                  type: 'string',
                  description: 'Optional event description'
                },
                location: {
                  type: 'string',
                  description: 'Optional event location'
                },
                allDay: {
                  type: 'boolean',
                  description: 'Whether this is an all-day event'
                },
                timezone: {
                  type: 'string',
                  description: 'Optional timezone for this specific event'
                },
                duration: {
                  type: 'string',
                  description: 'Optional duration if end time not provided (e.g., "2h", "30m", "1d")'
                }
              },
              required: ['title', 'start']
            }
          },
          defaultTimezone: {
            type: 'string',
            description: 'Default timezone for events that don\'t specify one'
          },
          defaultDuration: {
            type: 'string',
            description: 'Default duration for events without end time or duration (e.g., "1h")'
          }
        },
        required: ['events']
      }
    };
  }
}