export class CalendarRenderer {
  /**
   * Generate the calendar page HTML that loads the bundled React app
   */
  static generateCalendarPage(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Adventure Harmony Calendar</title>
    
    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        * {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        /* Custom FullCalendar styles for shadcn theme */
        .fc {
            --fc-border-color: #e5e7eb;
            --fc-button-text-color: #374151;
            --fc-button-bg-color: white;
            --fc-button-border-color: #e5e7eb;
            --fc-button-hover-bg-color: #f9fafb;
            --fc-button-hover-border-color: #d1d5db;
            --fc-button-active-bg-color: #f3f4f6;
            --fc-button-active-border-color: #d1d5db;
            --fc-today-bg-color: #eff6ff;
            --fc-event-bg-color: #3b82f6;
            --fc-event-border-color: #3b82f6;
            --fc-event-text-color: white;
        }
        
        .fc-event {
            border-radius: 0.375rem;
            padding: 0.125rem 0.5rem;
            font-size: 0.875rem;
            font-weight: 500;
            transition: all 0.2s;
        }
        
        .fc-event:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
        }
        
        .fc-daygrid-day-number {
            padding: 0.5rem;
            font-weight: 500;
        }
        
        .fc-col-header-cell-cushion {
            padding: 0.5rem;
            font-weight: 600;
            text-transform: uppercase;
            font-size: 0.75rem;
            color: #6b7280;
        }
        
        .fc-daygrid-more-link {
            color: #3b82f6;
            font-weight: 600;
        }
        
        .fc-popover {
            border-radius: 0.5rem;
            box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
            border: 1px solid #e5e7eb;
        }
        
        .fc-popover-header {
            background-color: #f9fafb;
            padding: 0.75rem;
            font-weight: 600;
            border-radius: 0.5rem 0.5rem 0 0;
        }
        
        .fc-list-event-time {
            color: #6b7280;
        }
        
        .fc-list-event-title {
            color: #111827;
            font-weight: 500;
        }
        
        .fc-list-day-cushion {
            background-color: #f3f4f6;
            font-weight: 600;
            padding: 0.75rem;
        }
    </style>
</head>
<body>
    <div id="root"></div>
    
    <!-- Bundled Calendar App -->
    <script src="/public/calendar.js"></script>
</body>
</html>`;
  }
}