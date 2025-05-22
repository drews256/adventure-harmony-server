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
        :root {
            --primary-color: #2563eb;
            --primary-dark: #1d4ed8;
            --secondary-color: #f1f5f9;
            --accent-color: #10b981;
            --text-primary: #0f172a;
            --text-secondary: #64748b;
            --border-color: #e2e8f0;
            --shadow-light: 0 1px 3px rgba(0, 0, 0, 0.05);
            --shadow-medium: 0 4px 6px rgba(0, 0, 0, 0.07);
            --shadow-large: 0 10px 25px rgba(0, 0, 0, 0.1);
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif;
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
            opacity: 0;
            animation: fadeInPage 0.8s ease-out forwards;
        }
        
        @keyframes fadeInPage {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @keyframes slideInFromTop {
            from {
                opacity: 0;
                transform: translateY(-30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @keyframes slideInFromBottom {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @keyframes scaleIn {
            from {
                opacity: 0;
                transform: scale(0.95);
            }
            to {
                opacity: 1;
                transform: scale(1);
            }
        }
        
        @keyframes shimmer {
            0% {
                background-position: -200px 0;
            }
            100% {
                background-position: calc(200px + 100%) 0;
            }
        }
        
        @keyframes pulse {
            0%, 100% {
                opacity: 1;
            }
            50% {
                opacity: 0.7;
            }
        }
        
        @keyframes ripple {
            to {
                transform: scale(4);
                opacity: 0;
            }
        }
        
        .header {
            background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-dark) 100%);
            color: white;
            padding: 2rem 1rem;
            text-align: center;
            position: relative;
            overflow: hidden;
            animation: slideInFromTop 0.6s ease-out;
        }
        
        .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>');
            opacity: 0.3;
        }
        
        .header h1 {
            font-size: 2rem;
            font-weight: 700;
            letter-spacing: -0.025em;
            position: relative;
            z-index: 1;
        }
        
        .container {
            max-width: 1200px;
            margin: -1rem auto 2rem;
            padding: 0 1rem;
            position: relative;
            z-index: 10;
        }
        
        .calendar-wrapper {
            background: white;
            border-radius: 16px;
            box-shadow: var(--shadow-large);
            overflow: hidden;
            border: 1px solid var(--border-color);
            animation: scaleIn 0.7s ease-out 0.2s both;
        }
        
        .loading-skeleton {
            background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
            background-size: 200px 100%;
            animation: shimmer 1.5s infinite;
            border-radius: 4px;
        }
        
        #calendar {
            padding: 1.5rem;
        }
        
        /* FullCalendar Custom Styling */
        .fc {
            font-family: inherit;
            --fc-border-color: var(--border-color);
            --fc-button-text-color: var(--text-primary);
            --fc-button-bg-color: white;
            --fc-button-border-color: var(--border-color);
            --fc-button-hover-bg-color: var(--secondary-color);
            --fc-button-hover-border-color: var(--primary-color);
            --fc-button-active-bg-color: var(--primary-color);
            --fc-button-active-border-color: var(--primary-color);
            --fc-today-bg-color: rgba(37, 99, 235, 0.05);
            --fc-neutral-bg-color: white;
            --fc-neutral-text-color: var(--text-primary);
            --fc-non-business-color: #f8f9fa;
        }
        
        .fc-header-toolbar {
            margin-bottom: 1.5rem !important;
            padding: 0 0.5rem;
        }
        
        .fc-toolbar-chunk {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .fc-button {
            padding: 0.5rem 1rem !important;
            font-weight: 500 !important;
            border-radius: 8px !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            font-size: 0.875rem !important;
            box-shadow: var(--shadow-light) !important;
            position: relative !important;
            overflow: hidden !important;
        }
        
        .fc-button:hover {
            transform: translateY(-2px) !important;
            box-shadow: var(--shadow-medium) !important;
        }
        
        .fc-button:active {
            transform: translateY(0) !important;
            transition: all 0.1s ease !important;
        }
        
        .fc-button::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 0;
            height: 0;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            transform: translate(-50%, -50%);
            transition: width 0.3s ease, height 0.3s ease;
        }
        
        .fc-button:active::before {
            width: 300px;
            height: 300px;
            animation: ripple 0.6s ease-out;
        }
        
        .fc-button-primary {
            background-color: var(--primary-color) !important;
            border-color: var(--primary-color) !important;
            color: white !important;
        }
        
        .fc-button-primary:hover {
            background-color: var(--primary-dark) !important;
            border-color: var(--primary-dark) !important;
        }
        
        .fc-toolbar-title {
            font-size: 1.5rem !important;
            font-weight: 700 !important;
            color: var(--text-primary) !important;
            letter-spacing: -0.025em;
        }
        
        .fc-daygrid-day {
            background: white;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
        }
        
        .fc-daygrid-day:hover {
            background-color: rgba(37, 99, 235, 0.02);
            transform: scale(1.02);
        }
        
        .fc-daygrid-day-frame {
            opacity: 0;
            animation: slideInFromBottom 0.5s ease-out forwards;
        }
        
        .fc-daygrid-day:nth-child(1) .fc-daygrid-day-frame { animation-delay: 0.05s; }
        .fc-daygrid-day:nth-child(2) .fc-daygrid-day-frame { animation-delay: 0.1s; }
        .fc-daygrid-day:nth-child(3) .fc-daygrid-day-frame { animation-delay: 0.15s; }
        .fc-daygrid-day:nth-child(4) .fc-daygrid-day-frame { animation-delay: 0.2s; }
        .fc-daygrid-day:nth-child(5) .fc-daygrid-day-frame { animation-delay: 0.25s; }
        .fc-daygrid-day:nth-child(6) .fc-daygrid-day-frame { animation-delay: 0.3s; }
        .fc-daygrid-day:nth-child(7) .fc-daygrid-day-frame { animation-delay: 0.35s; }
        
        .fc-daygrid-day-number {
            font-weight: 600;
            color: var(--text-primary) !important;
            padding: 0.5rem;
            font-size: 0.875rem;
        }
        
        .fc-daygrid-day-number:hover {
            color: var(--primary-color) !important;
        }
        
        .fc-daygrid-day-top {
            display: flex;
            justify-content: center;
        }
        
        .fc-col-header-cell {
            background-color: var(--secondary-color);
            border-color: var(--border-color);
            font-weight: 600;
            text-transform: uppercase;
            font-size: 0.75rem;
            letter-spacing: 0.05em;
            color: var(--text-secondary);
            padding: 0.75rem 0.5rem;
        }
        
        .fc-daygrid-event {
            border-radius: 6px !important;
            border: none !important;
            padding: 2px 6px !important;
            font-size: 0.75rem !important;
            font-weight: 500 !important;
            margin: 1px 2px !important;
            background: linear-gradient(135deg, var(--accent-color), #059669) !important;
            color: white !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            cursor: pointer !important;
            opacity: 0 !important;
            animation: scaleIn 0.4s ease-out forwards !important;
            position: relative !important;
            overflow: hidden !important;
        }
        
        .fc-daygrid-event:hover {
            transform: translateY(-2px) scale(1.02) !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
        }
        
        .fc-daygrid-event:active {
            transform: translateY(0) scale(0.98) !important;
            transition: all 0.1s ease !important;
        }
        
        .fc-daygrid-event::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: left 0.5s ease;
        }
        
        .fc-daygrid-event:hover::before {
            left: 100%;
        }
        
        .fc-daygrid-event-dot {
            display: none !important;
        }
        
        .fc-list-event {
            border-radius: 8px !important;
            margin-bottom: 0.5rem !important;
            border: 1px solid var(--border-color) !important;
            background: white !important;
            box-shadow: var(--shadow-light) !important;
            overflow: hidden !important;
            opacity: 0 !important;
            animation: slideInFromBottom 0.5s ease-out forwards !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        
        .fc-list-event:hover {
            box-shadow: var(--shadow-medium) !important;
            transform: translateY(-2px) scale(1.01) !important;
            border-color: var(--primary-color) !important;
        }
        
        .fc-list-event:nth-child(1) { animation-delay: 0.1s !important; }
        .fc-list-event:nth-child(2) { animation-delay: 0.2s !important; }
        .fc-list-event:nth-child(3) { animation-delay: 0.3s !important; }
        .fc-list-event:nth-child(4) { animation-delay: 0.4s !important; }
        .fc-list-event:nth-child(5) { animation-delay: 0.5s !important; }
        
        .fc-list-event-graphic {
            background: linear-gradient(135deg, var(--accent-color), #059669) !important;
            width: 4px !important;
        }
        
        .fc-list-event-title {
            font-weight: 600 !important;
            color: var(--text-primary) !important;
            padding: 0.75rem !important;
        }
        
        .fc-list-event-time {
            color: var(--text-secondary) !important;
            font-weight: 500 !important;
            padding: 0.5rem 0.75rem !important;
            background: var(--secondary-color) !important;
        }
        
        .fc-list-day-cushion {
            background: var(--secondary-color) !important;
            color: var(--text-primary) !important;
            font-weight: 600 !important;
            padding: 0.75rem !important;
            border-bottom: 1px solid var(--border-color) !important;
        }
        
        .fc-list-table {
            border: none !important;
        }
        
        .fc-list-event-dot {
            display: none !important;
        }
        
        .fc-list-day-side-text {
            color: var(--text-primary) !important;
            font-weight: 600 !important;
        }
        
        .fc-list-day-text {
            color: var(--text-secondary) !important;
            font-size: 0.875rem !important;
        }
        
        /* Fix popover and more events styling */
        .fc-popover {
            background: white !important;
            border: 1px solid var(--border-color) !important;
            border-radius: 8px !important;
            box-shadow: var(--shadow-large) !important;
            z-index: 1000 !important;
        }
        
        .fc-popover-header {
            background: var(--secondary-color) !important;
            color: var(--text-primary) !important;
            padding: 0.75rem !important;
            font-weight: 600 !important;
            border-bottom: 1px solid var(--border-color) !important;
            border-radius: 8px 8px 0 0 !important;
        }
        
        .fc-popover-body {
            padding: 0.5rem !important;
            background: white !important;
        }
        
        .fc-popover .fc-daygrid-event {
            margin: 0.25rem !important;
            background: linear-gradient(135deg, var(--accent-color), #059669) !important;
            color: white !important;
            padding: 0.5rem !important;
            border-radius: 6px !important;
            font-weight: 500 !important;
        }
        
        .fc-popover .fc-daygrid-event:hover {
            transform: none !important;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15) !important;
        }
        
        .fc-daygrid-more-link {
            color: var(--primary-color) !important;
            font-weight: 600 !important;
            padding: 0.25rem 0.5rem !important;
            border-radius: 4px !important;
            transition: all 0.2s ease !important;
            text-decoration: none !important;
        }
        
        .fc-daygrid-more-link:hover {
            background: var(--secondary-color) !important;
            color: var(--primary-dark) !important;
        }
        
        /* Fix text color issues */
        .fc-col-header-cell-cushion {
            color: var(--text-secondary) !important;
        }
        
        .fc-daygrid-day-events {
            margin-top: 0.25rem !important;
        }
        
        .fc-event-title {
            color: white !important;
            font-weight: 500 !important;
        }
        
        .fc-event-time {
            color: rgba(255, 255, 255, 0.9) !important;
            font-size: 0.7rem !important;
        }
        
        .refresh-hint {
            text-align: center;
            padding: 1rem;
            color: var(--text-secondary);
            font-size: 0.875rem;
            background: rgba(255, 255, 255, 0.7);
            margin-top: 1rem;
            border-radius: 0 0 16px 16px;
            border-top: 1px solid var(--border-color);
            backdrop-filter: blur(10px);
            animation: slideInFromBottom 0.6s ease-out 0.4s both;
            transition: all 0.3s ease;
        }
        
        .refresh-hint:hover {
            background: rgba(255, 255, 255, 0.9);
            transform: translateY(-1px);
        }
        
        /* Mobile Responsiveness */
        @media (max-width: 768px) {
            .header {
                padding: 1.5rem 1rem;
            }
            
            .header h1 {
                font-size: 1.75rem;
            }
            
            .container {
                margin: -0.5rem auto 1rem;
                padding: 0 0.75rem;
            }
            
            #calendar {
                padding: 1rem;
            }
            
            .fc-header-toolbar {
                flex-direction: column !important;
                gap: 1rem !important;
                align-items: center !important;
            }
            
            .fc-toolbar-title {
                font-size: 1.25rem !important;
                order: -1;
            }
            
            .fc-button {
                font-size: 0.8rem !important;
                padding: 0.4rem 0.8rem !important;
            }
            
            .fc-today-button {
                display: none !important;
            }
        }
        
        @media (max-width: 480px) {
            .header h1 {
                font-size: 1.5rem;
            }
            
            .container {
                padding: 0 0.5rem;
            }
            
            #calendar {
                padding: 0.75rem;
            }
            
            .fc-button {
                font-size: 0.75rem !important;
                padding: 0.35rem 0.7rem !important;
            }
            
            .fc-daygrid-event {
                font-size: 0.7rem !important;
                padding: 1px 4px !important;
            }
            
            .fc-daygrid-day-number {
                font-size: 0.8rem;
                padding: 0.25rem;
            }
            
            .fc-col-header-cell {
                font-size: 0.7rem;
                padding: 0.5rem 0.25rem;
            }
        }
        
        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
            :root {
                --primary-color: #3b82f6;
                --primary-dark: #2563eb;
                --secondary-color: #1e293b;
                --accent-color: #10b981;
                --text-primary: #f8fafc;
                --text-secondary: #94a3b8;
                --border-color: #334155;
                --shadow-light: 0 1px 3px rgba(0, 0, 0, 0.3);
                --shadow-medium: 0 4px 6px rgba(0, 0, 0, 0.4);
                --shadow-large: 0 10px 25px rgba(0, 0, 0, 0.5);
            }
            
            body {
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            }
            
            .calendar-wrapper {
                background: #1e293b;
                border-color: var(--border-color);
            }
            
            .fc-daygrid-day {
                background: #1e293b !important;
            }
            
            .fc-col-header-cell {
                background-color: #334155 !important;
                color: var(--text-secondary) !important;
            }
            
            .refresh-hint {
                background: rgba(30, 41, 59, 0.9);
            }
            
            .fc-popover {
                background: #1e293b !important;
                border-color: var(--border-color) !important;
            }
            
            .fc-popover-header {
                background: #334155 !important;
                color: var(--text-primary) !important;
            }
            
            .fc-popover-body {
                background: #1e293b !important;
            }
            
            .fc-list-event {
                background: #1e293b !important;
                border-color: var(--border-color) !important;
            }
            
            .fc-list-event-time {
                background: #334155 !important;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${title}</h1>
    </div>
    
    <div class="container">
        <div class="calendar-wrapper">
            <div id="calendar"></div>
            <div class="refresh-hint">
                Pull down to refresh • ${events.length} total events
            </div>
        </div>
    </div>
    
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            var calendarEl = document.getElementById('calendar');
            
            // Add loading animation
            calendarEl.innerHTML = \`
                <div style="display: flex; justify-content: center; align-items: center; height: 300px; flex-direction: column;">
                    <div style="width: 40px; height: 40px; border: 3px solid var(--border-color); border-top: 3px solid var(--primary-color); border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 1rem;"></div>
                    <div style="color: var(--text-secondary); font-size: 0.875rem;">Loading calendar...</div>
                </div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            \`;
            
            // Simulate loading delay for smooth animations
            setTimeout(function() {
            
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
            
            // Add stagger animation to events after render
            setTimeout(function() {
                const events = document.querySelectorAll('.fc-daygrid-event');
                events.forEach((event, index) => {
                    event.style.animationDelay = (index * 0.05) + 's';
                });
                
                const listEvents = document.querySelectorAll('.fc-list-event');
                listEvents.forEach((event, index) => {
                    event.style.animationDelay = (index * 0.1) + 's';
                });
            }, 100);
            
            // Switch to list view on very small screens with animation
            function checkScreenSize() {
                if (window.innerWidth < 480 && calendar.view.type !== 'listWeek') {
                    calendarEl.style.opacity = '0';
                    calendarEl.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        calendar.changeView('listWeek');
                        calendarEl.style.transition = 'all 0.3s ease';
                        calendarEl.style.opacity = '1';
                        calendarEl.style.transform = 'scale(1)';
                    }, 150);
                }
            }
            
            window.addEventListener('resize', checkScreenSize);
            checkScreenSize();
            
            }, 800); // End of loading delay
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