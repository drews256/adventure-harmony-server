import { CalendarRenderer } from './calendar-renderer';
import { createClient } from '@supabase/supabase-js';
import { MCPTool } from './goguide-api';
import { StandardizedEvent } from './event-formatter';

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  allDay: boolean;
}

export interface CalendarToolArgs {
  events: StandardizedEvent[];
  title?: string;
  timezone?: string;
}

/**
 * Calendar tool for displaying mobile-optimized calendars from iCal feeds
 */
export class CalendarTool {
  private supabase;
  
  constructor(supabase: any) {
    this.supabase = supabase;
  }

  /**
   * Parse iCal content and extract events
   */
  private parseICalContent(icalContent: string): CalendarEvent[] {
    const events: CalendarEvent[] = [];
    const lines = icalContent.split('\n').map(line => line.trim());
    
    let currentEvent: Partial<CalendarEvent> | null = null;
    let inEvent = false;

    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') {
        inEvent = true;
        currentEvent = {
          id: Math.random().toString(36).substr(2, 9),
          allDay: false
        };
      } else if (line === 'END:VEVENT' && currentEvent && inEvent) {
        if (currentEvent.title && currentEvent.start && currentEvent.end) {
          events.push(currentEvent as CalendarEvent);
        }
        currentEvent = null;
        inEvent = false;
      } else if (inEvent && currentEvent) {
        if (line.startsWith('SUMMARY:')) {
          currentEvent.title = line.substring(8).replace(/\\n/g, '\n').replace(/\\,/g, ',');
        } else if (line.startsWith('DTSTART')) {
          const dateStr = line.includes('VALUE=DATE:') 
            ? line.split('VALUE=DATE:')[1]
            : line.split(':')[1];
          currentEvent.start = this.parseICalDate(dateStr);
          if (line.includes('VALUE=DATE')) {
            currentEvent.allDay = true;
          }
        } else if (line.startsWith('DTEND')) {
          const dateStr = line.includes('VALUE=DATE:') 
            ? line.split('VALUE=DATE:')[1]
            : line.split(':')[1];
          currentEvent.end = this.parseICalDate(dateStr);
        } else if (line.startsWith('DESCRIPTION:')) {
          currentEvent.description = line.substring(12).replace(/\\n/g, '\n').replace(/\\,/g, ',');
        } else if (line.startsWith('LOCATION:')) {
          currentEvent.location = line.substring(9).replace(/\\n/g, '\n').replace(/\\,/g, ',');
        } else if (line.startsWith('UID:')) {
          currentEvent.id = line.substring(4);
        }
      }
    }

    return events.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  /**
   * Generate iCal content from standardized events
   */
  private generateICalContent(events: StandardizedEvent[], title: string = 'Calendar'): string {
    const now = new Date();
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Adventure Harmony Planner//Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${title}`,
      'X-WR-TIMEZONE:America/New_York'
    ];

    for (const event of events) {
      // Ensure dates are Date objects
      const startDate = typeof event.start === 'string' ? new Date(event.start) : event.start;
      const endDate = typeof event.end === 'string' ? new Date(event.end) : event.end;
      
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${event.id}`);
      lines.push(`DTSTAMP:${this.formatICalDate(now)}`);
      lines.push(`DTSTART${event.allDay ? ';VALUE=DATE' : ''}:${this.formatICalDate(startDate, event.allDay)}`);
      lines.push(`DTEND${event.allDay ? ';VALUE=DATE' : ''}:${this.formatICalDate(endDate, event.allDay)}`);
      lines.push(`SUMMARY:${this.escapeICalText(event.title)}`);
      
      if (event.description) {
        lines.push(`DESCRIPTION:${this.escapeICalText(event.description)}`);
      }
      
      if (event.location) {
        lines.push(`LOCATION:${this.escapeICalText(event.location)}`);
      }
      
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  /**
   * Format a Date object to iCal format
   */
  private formatICalDate(date: Date, allDay: boolean = false): string {
    if (allDay) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    } else {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const minute = String(date.getMinutes()).padStart(2, '0');
      const second = String(date.getSeconds()).padStart(2, '0');
      return `${year}${month}${day}T${hour}${minute}${second}Z`;
    }
  }

  /**
   * Escape text for iCal format
   */
  private escapeICalText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '');
  }

  /**
   * Convert StandardizedEvent to CalendarEvent for compatibility
   * Handles the case where dates might be serialized as strings
   */
  private convertToCalendarEvent(event: StandardizedEvent): CalendarEvent {
    return {
      id: event.id,
      title: event.title,
      start: typeof event.start === 'string' ? new Date(event.start) : event.start,
      end: typeof event.end === 'string' ? new Date(event.end) : event.end,
      description: event.description,
      location: event.location,
      allDay: event.allDay
    };
  }

  /**
   * Parse iCal date format to JavaScript Date
   */
  private parseICalDate(dateStr: string): Date {
    // Handle basic date format: YYYYMMDD
    if (dateStr.length === 8) {
      const year = parseInt(dateStr.substring(0, 4));
      const month = parseInt(dateStr.substring(4, 6)) - 1; // JS months are 0-indexed
      const day = parseInt(dateStr.substring(6, 8));
      return new Date(year, month, day);
    }
    
    // Handle datetime format: YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS
    if (dateStr.includes('T')) {
      const [datePart, timePart] = dateStr.split('T');
      const year = parseInt(datePart.substring(0, 4));
      const month = parseInt(datePart.substring(4, 6)) - 1;
      const day = parseInt(datePart.substring(6, 8));
      
      const timeClean = timePart.replace('Z', '');
      const hour = parseInt(timeClean.substring(0, 2));
      const minute = parseInt(timeClean.substring(2, 4));
      const second = timeClean.length >= 6 ? parseInt(timeClean.substring(4, 6)) : 0;
      
      return new Date(year, month, day, hour, minute, second);
    }
    
    // Fallback to current date
    return new Date();
  }

  /**
   * Fetch iCal content from URL
   */
  private async fetchICalContent(url: string): Promise<string> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch iCal: ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      throw new Error(`Error fetching iCal from ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate mobile-optimized HTML calendar
   */
    private generateMobileCalendarHTML(events: CalendarEvent[], title: string = 'Calendar'): string {
    // Use the new React-based calendar renderer
    return CalendarRenderer.generateCalendarPage();
  }


  /**
   * Format event time for display
   */
  private formatEventTime(event: CalendarEvent): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    
    // Handle both Date objects and string dates
    const startDate = typeof event.start === 'string' ? new Date(event.start) : event.start;
    const endDate = typeof event.end === 'string' ? new Date(event.end) : event.end;
    const eventDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    
    let datePrefix = '';
    if (eventDate.getTime() === today.getTime()) {
      datePrefix = 'Today, ';
    } else if (eventDate.getTime() === tomorrow.getTime()) {
      datePrefix = 'Tomorrow, ';
    } else {
      datePrefix = startDate.toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      }) + ', ';
    }
    
    if (event.allDay) {
      return datePrefix.replace(', ', '');
    }
    
    const startTime = startDate.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    
    const endTime = endDate.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    
    return `${datePrefix}${startTime} - ${endTime}`;
  }

  /**
   * Escape HTML characters
   */
  private escapeHtml(text: string): string {
    const div = { innerHTML: '' } as any;
    div.textContent = text;
    return div.innerHTML || text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Create calendar from standardized events and return hosted link with iCal download
   */
  async createCalendar(args: CalendarToolArgs): Promise<{ url: string; icalUrl: string; eventCount: number }> {
    try {
      // Convert StandardizedEvents to CalendarEvents for HTML generation
      const calendarEvents = args.events.map(event => this.convertToCalendarEvent(event));
      
      // Generate iCal content
      const icalContent = this.generateICalContent(args.events, args.title || 'Calendar');
      
      // Generate HTML
      const html = this.generateMobileCalendarHTML(calendarEvents, args.title || 'Calendar');
      
      // Store HTML and iCal in database with unique ID
      const calendarId = Math.random().toString(36).substr(2, 12);
      
      // First, check if the ical_content column exists
      let insertData: any = {
        id: calendarId,
        title: args.title || 'Calendar',
        ical_url: null, // No longer using external iCal URL
        html_content: html,
        event_count: args.events.length,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Try to include ical_content, but handle gracefully if column doesn't exist
      try {
        insertData.ical_content = icalContent;
        var { error } = await this.supabase
          .from('calendar_displays')
          .insert(insertData);
      } catch (schemaError) {
        console.warn('ical_content column may not exist, inserting without it:', schemaError);
        delete insertData.ical_content;
        var { error } = await this.supabase
          .from('calendar_displays')
          .insert(insertData);
      }
      
      if (error) {
        throw new Error(`Failed to store calendar: ${error.message}`);
      }
      
      // Return the hosted URLs
      const baseUrl = process.env.BASE_URL || 'https://adventure-harmony-09bcd11c3365.herokuapp.com';
      return {
        url: `${baseUrl}/calendar/${calendarId}`,
        icalUrl: `${baseUrl}/calendar/${calendarId}/ical`,
        eventCount: args.events.length
      };
      
    } catch (error) {
      throw new Error(`Calendar creation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get calendar HTML by ID
   */
    async getCalendarHTML(calendarId: string): Promise<string | null> {
    try {
      // Return the React-based calendar page
      // The actual data will be fetched by the React component
      return CalendarRenderer.generateCalendarPage();
    } catch (error) {
      console.error('Error generating calendar HTML:', error);
      return null;
    }
  }


  /**
   * Get calendar iCal content by ID
   */
  async getCalendarICal(calendarId: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabase
        .from('calendar_displays')
        .select('ical_content')
        .eq('id', calendarId)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      return data.ical_content || null;
    } catch (error) {
      console.error('Error fetching calendar iCal:', error);
      // If ical_content column doesn't exist, return a basic iCal
      return 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Adventure Harmony Planner//Calendar//EN\nEND:VCALENDAR';
    }
  }  /**
   * Get calendar data for React component
   */
  async getCalendarData(calendarId: string): Promise<{ title: string; events: CalendarEvent[]; calendarId: string } | null> {
    try {
      const { data, error } = await this.supabase
        .from('calendar_displays')
        .select('*')
        .eq('id', calendarId)
        .single();
        
      if (error || !data) {
        return null;
      }
      
      // Parse events
      const events = data.events;
      
      return {
        title: data.title || 'Calendar',
        events: events,
        calendarId: calendarId
      };
    } catch (error) {
      console.error('Error getting calendar data:', error);
      return null;
    }
  }


  /**
   * Get MCP tool definition
   */
  static getToolDefinition(): MCPTool {
    return {
      name: 'Calendar_GenerateDisplay',
      description: 'Creates a mobile-optimized calendar view from standardized event data, generates iCal content, and returns hosted links',
      inputSchema: {
        type: 'object',
        properties: {
          events: {
            type: 'array',
            description: 'Array of standardized event objects (typically from Calendar_FormatEvents tool)',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique event identifier' },
                title: { type: 'string', description: 'Event title' },
                start: { type: 'string', description: 'Start date/time as ISO string' },
                end: { type: 'string', description: 'End date/time as ISO string' },
                description: { type: 'string', description: 'Optional event description' },
                location: { type: 'string', description: 'Optional event location' },
                allDay: { type: 'boolean', description: 'Whether this is an all-day event' },
                timezone: { type: 'string', description: 'Optional timezone for this event' }
              },
              required: ['id', 'title', 'start', 'end', 'allDay']
            }
          },
          title: {
            type: 'string',
            description: 'Optional title for the calendar display'
          },
          timezone: {
            type: 'string',
            description: 'Optional default timezone for the calendar'
          }
        },
        required: ['events']
      }
    };
  }
}