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
    const now = new Date();
    // Handle both Date objects and string dates for filtering
    // Temporarily show all events for debugging
    const upcomingEvents = events.slice(0, 50); // Show all events, limit to 50
    
    // Original upcoming filter (commented out for debugging):
    // const upcomingEvents = events.filter(event => {
    //   const eventDate = typeof event.start === 'string' ? new Date(event.start) : event.start;
    //   return eventDate >= now;
    // }).slice(0, 50);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <script src='https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.js'></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #f5f5f7;
            color: #1d1d1f;
            line-height: 1.4;
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1rem;
            text-align: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .header h1 {
            font-size: 1.5rem;
            font-weight: 600;
        }
        
        .container {
            max-width: 100%;
            margin: 0 auto;
            padding: 1rem;
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin: 1rem;
        }
        
        #calendar {
            max-width: 100%;
            margin: 0 auto;
        }
        
        /* FullCalendar mobile optimizations */
        .fc {
            font-size: 0.85rem;
        }
        
        .fc-header-toolbar {
            flex-direction: column;
            gap: 0.5rem;
        }
        
        .fc-toolbar-chunk {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .fc-button {
            padding: 0.3rem 0.6rem;
            font-size: 0.8rem;
        }
        
        .fc-daygrid-event {
            font-size: 0.75rem;
            border-radius: 4px;
            padding: 2px 4px;
        }
        
        .refresh-hint {
            text-align: center;
            padding: 1rem;
            color: #8e8e93;
            font-size: 0.8rem;
            background: #f5f5f7;
            margin-top: 1rem;
            border-radius: 8px;
        }
        
        @media (max-width: 768px) {
            .container {
                margin: 0.5rem;
                padding: 0.5rem;
            }
            
            .fc-header-toolbar {
                font-size: 0.8rem;
            }
            
            .fc-daygrid-day-number {
                font-size: 0.8rem;
            }
            
            /* Hide some buttons on very small screens */
            .fc-today-button {
                display: none;
            }
        }
        
        @media (max-width: 480px) {
            .header {
                padding: 0.75rem;
            }
            
            .header h1 {
                font-size: 1.3rem;
            }
            
            .fc {
                font-size: 0.75rem;
            }
            
            .fc-daygrid-event {
                font-size: 0.7rem;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${title}</h1>
    </div>
    
    <div class="container">
        <div id="calendar"></div>
        
        <div class="refresh-hint">
            Pull down to refresh • ${events.length} total events
        </div>
    </div>
    
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            var calendarEl = document.getElementById('calendar');
            
            // Prepare events data for FullCalendar
            var events = ${JSON.stringify(upcomingEvents.map(event => {
              const startDate = typeof event.start === 'string' ? new Date(event.start) : event.start;
              const endDate = typeof event.end === 'string' ? new Date(event.end) : event.end;
              return {
                title: event.title,
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                allDay: event.allDay,
                extendedProps: {
                  description: event.description,
                  location: event.location
                }
              };
            }))};
            
            var calendar = new FullCalendar.Calendar(calendarEl, {
                initialView: window.innerWidth < 768 ? 'listWeek' : 'dayGridMonth',
                headerToolbar: {
                    left: 'prev,next today',
                    center: 'title',
                    right: window.innerWidth < 768 ? 'listWeek,dayGridMonth' : 'dayGridMonth,listWeek'
                },
                events: events,
                eventDisplay: 'block',
                dayMaxEvents: 3,
                moreLinkClick: 'popover',
                eventClick: function(info) {
                    // Show event details
                    var props = info.event.extendedProps;
                    var details = info.event.title;
                    if (props.location) details += '\\n📍 ' + props.location;
                    if (props.description) details += '\\n\\n' + props.description;
                    alert(details);
                },
                height: 'auto',
                responsive: true
            });
            
            calendar.render();
            
            // Switch to list view on very small screens
            function checkScreenSize() {
                if (window.innerWidth < 480 && calendar.view.type !== 'listWeek') {
                    calendar.changeView('listWeek');
                }
            }
            
            window.addEventListener('resize', checkScreenSize);
            checkScreenSize();
        });
        
        // Add pull-to-refresh functionality
        let startY = 0;
        let isRefreshing = false;
        
        document.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
        });
        
        document.addEventListener('touchmove', (e) => {
            const currentY = e.touches[0].clientY;
            const diff = currentY - startY;
            
            if (diff > 100 && window.scrollY === 0 && !isRefreshing) {
                isRefreshing = true;
                setTimeout(() => {
                    window.location.reload();
                }, 300);
            }
        });
    </script>
</body>
</html>`;
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
      const { data, error } = await this.supabase
        .from('calendar_displays')
        .select('html_content')
        .eq('id', calendarId)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      return data.html_content;
    } catch (error) {
      console.error('Error fetching calendar HTML:', error);
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