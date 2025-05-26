export class CalendarRenderer {
  /**
   * Generate the calendar page HTML that loads calendar config dynamically with shadcn/ui styling
   */
  static generateCalendarPage(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Adventure Harmony Calendar</title>
    
    <!-- React -->
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    
    <!-- FullCalendar -->
    <script crossorigin src="https://unpkg.com/@fullcalendar/core@6.1.11/index.global.min.js"></script>
    <script crossorigin src="https://unpkg.com/@fullcalendar/react@6.1.11/index.global.min.js"></script>
    <script crossorigin src="https://unpkg.com/@fullcalendar/daygrid@6.1.11/index.global.min.js"></script>
    <script crossorigin src="https://unpkg.com/@fullcalendar/list@6.1.11/index.global.min.js"></script>
    <script crossorigin src="https://unpkg.com/@fullcalendar/interaction@6.1.11/index.global.min.js"></script>
    
    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    
    <!-- Date-fns -->
    <script src="https://unpkg.com/date-fns@2.30.0/index.umd.min.js"></script>
    
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
    
    <script>
        const { useState, useEffect, useRef, createElement: h } = React;
        
        // Get calendar ID from URL
        const calendarId = window.location.pathname.split('/').pop();
        
        // Utility function to combine classes
        const cn = (...classes) => classes.filter(Boolean).join(' ');
        
        // Card components
        const Card = ({ children, className, ...props }) => 
            h('div', { 
                className: cn('rounded-lg border border-slate-200 bg-white text-slate-950 shadow-sm', className),
                ...props
            }, children);
            
        const CardHeader = ({ children, className }) => 
            h('div', { className: cn('flex flex-col space-y-1.5 p-6', className) }, children);
            
        const CardTitle = ({ children, className }) => 
            h('h3', { className: cn('text-2xl font-semibold leading-none tracking-tight', className) }, children);
            
        const CardDescription = ({ children, className }) => 
            h('p', { className: cn('text-sm text-slate-500', className) }, children);
            
        const CardContent = ({ children, className }) => 
            h('div', { className: cn('p-6 pt-0', className) }, children);
        
        // Button component
        const Button = ({ children, variant = 'default', size = 'default', className, ...props }) => {
            const variants = {
                default: 'bg-slate-900 text-slate-50 hover:bg-slate-900/90',
                outline: 'border border-slate-200 bg-white hover:bg-slate-100 hover:text-slate-900',
            };
            
            const sizes = {
                default: 'h-10 px-4 py-2',
                sm: 'h-9 rounded-md px-3',
            };
            
            return h('button', {
                className: cn(
                    'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
                    variants[variant],
                    sizes[size],
                    className
                ),
                ...props
            }, children);
        };
        
        // Icons
        const ChevronLeft = ({ className }) => h('svg', {
            className: cn('h-4 w-4', className),
            fill: 'none',
            stroke: 'currentColor',
            viewBox: '0 0 24 24'
        }, h('path', {
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            strokeWidth: 2,
            d: 'M15 19l-7-7 7-7'
        }));
        
        const ChevronRight = ({ className }) => h('svg', {
            className: cn('h-4 w-4', className),
            fill: 'none',
            stroke: 'currentColor',
            viewBox: '0 0 24 24'
        }, h('path', {
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            strokeWidth: 2,
            d: 'M9 5l7 7-7 7'
        }));
        
        const Calendar = ({ className }) => h('svg', {
            className: cn('h-4 w-4', className),
            fill: 'none',
            stroke: 'currentColor',
            viewBox: '0 0 24 24'
        }, h('path', {
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            strokeWidth: 2,
            d: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'
        }));
        
        const List = ({ className }) => h('svg', {
            className: cn('h-4 w-4', className),
            fill: 'none',
            stroke: 'currentColor',
            viewBox: '0 0 24 24'
        }, h('path', {
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            strokeWidth: 2,
            d: 'M4 6h16M4 12h16M4 18h16'
        }));
        
        // Calendar component
        function CalendarApp() {
            const [config, setConfig] = useState(null);
            const [loading, setLoading] = useState(true);
            const [error, setError] = useState(null);
            const [view, setView] = useState('dayGridMonth');
            const [selectedEvent, setSelectedEvent] = useState(null);
            const calendarRef = useRef(null);
            
            useEffect(() => {
                // Fetch calendar data
                fetch(\`/api/calendar/\${calendarId}/data\`)
                    .then(res => {
                        if (!res.ok) throw new Error('Calendar not found');
                        return res.json();
                    })
                    .then(data => {
                        setConfig(data);
                        setTimeout(() => setLoading(false), 500);
                    })
                    .catch(err => {
                        setError(err.message);
                        setLoading(false);
                    });
            }, []);
            
            const handleEventClick = (clickInfo) => {
                const event = config.events.find(e => e.title === clickInfo.event.title);
                if (event) {
                    setSelectedEvent(event);
                }
            };
            
            const handlePrevious = () => {
                if (calendarRef.current) {
                    const calendarApi = calendarRef.current.getApi();
                    calendarApi.prev();
                }
            };
            
            const handleNext = () => {
                if (calendarRef.current) {
                    const calendarApi = calendarRef.current.getApi();
                    calendarApi.next();
                }
            };
            
            const handleToday = () => {
                if (calendarRef.current) {
                    const calendarApi = calendarRef.current.getApi();
                    calendarApi.today();
                }
            };
            
            const toggleView = () => {
                const newView = view === 'dayGridMonth' ? 'listWeek' : 'dayGridMonth';
                setView(newView);
                if (calendarRef.current) {
                    const calendarApi = calendarRef.current.getApi();
                    calendarApi.changeView(newView);
                }
            };
            
            if (loading) {
                return h('div', { className: 'min-h-screen bg-gray-50 p-4' },
                    h('div', { className: 'max-w-7xl mx-auto' },
                        h(Card, { className: 'animate-pulse' },
                            h(CardHeader, { className: 'bg-gradient-to-r from-blue-600 to-blue-700 text-white' },
                                h('div', { className: 'h-8 bg-white/20 rounded w-1/3' })
                            ),
                            h(CardContent, { className: 'p-6' },
                                h('div', { className: 'h-96 bg-gray-200 rounded' })
                            )
                        )
                    )
                );
            }
            
            if (error) {
                return h('div', { className: 'min-h-screen bg-gray-50 flex items-center justify-center p-4' },
                    h(Card, { className: 'w-full max-w-2xl' },
                        h(CardContent, { className: 'p-8' },
                            h('div', { className: 'bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded' }, error)
                        )
                    )
                );
            }
            
            if (!config) return null;
            
            return h('div', { className: 'min-h-screen bg-gray-50 p-4' },
                h('div', { className: 'max-w-7xl mx-auto' },
                    h(Card, { className: 'shadow-lg' },
                        h(CardHeader, { className: 'bg-gradient-to-r from-blue-600 to-blue-700 text-white' },
                            h(CardTitle, { className: 'text-2xl font-bold' }, config.title),
                            h(CardDescription, { className: 'text-blue-100' },
                                \`\${config.events.length} events • Pull down to refresh\`
                            )
                        ),
                        h(CardContent, { className: 'p-0' },
                            h('div', { className: 'border-b bg-gray-50 p-4' },
                                h('div', { className: 'flex flex-col sm:flex-row justify-between items-center gap-4' },
                                    h('div', { className: 'flex items-center gap-2' },
                                        h(Button, {
                                            variant: 'outline',
                                            size: 'sm',
                                            onClick: handlePrevious,
                                            className: 'h-9'
                                        }, h(ChevronLeft)),
                                        h(Button, {
                                            variant: 'outline',
                                            size: 'sm',
                                            onClick: handleNext,
                                            className: 'h-9'
                                        }, h(ChevronRight)),
                                        h(Button, {
                                            variant: 'outline',
                                            size: 'sm',
                                            onClick: handleToday,
                                            className: 'h-9'
                                        }, 'Today')
                                    ),
                                    h(Button, {
                                        variant: 'outline',
                                        size: 'sm',
                                        onClick: toggleView,
                                        className: 'h-9'
                                    },
                                        view === 'dayGridMonth' ? [
                                            h(List, { className: 'mr-2' }),
                                            'List View'
                                        ] : [
                                            h(Calendar, { className: 'mr-2' }),
                                            'Calendar View'
                                        ]
                                    )
                                )
                            ),
                            h('div', { className: 'p-4' },
                                h(FullCalendarReact.Calendar, {
                                    ref: calendarRef,
                                    plugins: [FullCalendarDayGrid.default, FullCalendarList.default, FullCalendarInteraction.default],
                                    initialView: view,
                                    headerToolbar: false,
                                    events: config.events.map(event => ({
                                        title: event.title,
                                        start: event.start,
                                        end: event.end,
                                        allDay: event.allDay,
                                        extendedProps: {
                                            description: event.description,
                                            location: event.location
                                        }
                                    })),
                                    eventClick: handleEventClick,
                                    height: 'auto',
                                    dayMaxEvents: 3,
                                    moreLinkClick: 'popover',
                                    eventClassNames: 'cursor-pointer',
                                    dayCellClassNames: 'hover:bg-gray-50 transition-colors',
                                    eventDisplay: 'block'
                                })
                            )
                        )
                    ),
                    
                    // Event Details Modal
                    selectedEvent && h('div', {
                        className: 'fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50',
                        onClick: () => setSelectedEvent(null)
                    },
                        h(Card, {
                            className: 'max-w-md w-full',
                            onClick: (e) => e.stopPropagation()
                        },
                            h(CardHeader, null,
                                h(CardTitle, null, selectedEvent.title),
                                h(CardDescription, null,
                                    dateFns.format(new Date(selectedEvent.start), 'PPP')
                                )
                            ),
                            h(CardContent, null,
                                selectedEvent.location && h('p', { className: 'text-sm text-gray-600 mb-2' },
                                    '📍 ', selectedEvent.location
                                ),
                                selectedEvent.description && h('p', { className: 'text-sm text-gray-700' },
                                    selectedEvent.description
                                ),
                                h(Button, {
                                    className: 'w-full mt-4',
                                    onClick: () => setSelectedEvent(null)
                                }, 'Close')
                            )
                        )
                    )
                )
            );
        }
        
        // Initial render with loading state
        ReactDOM.render(h(CalendarApp), document.getElementById('root'));
    </script>
</body>
</html>`;
  }
}