import React, { useState, useEffect } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { EventClickArg } from '@fullcalendar/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Calendar, List, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';

interface CalendarEvent {
  title: string;
  start: Date | string;
  end: Date | string;
  allDay?: boolean;
  description?: string;
  location?: string;
}

interface CalendarViewProps {
  title: string;
  events: CalendarEvent[];
  calendarId: string;
}

export const CalendarView: React.FC<CalendarViewProps> = ({ title, events, calendarId }) => {
  const [view, setView] = useState<'dayGridMonth' | 'listWeek'>('dayGridMonth');
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const calendarRef = React.useRef<FullCalendar>(null);

  useEffect(() => {
    // Simulate loading for smooth animation
    const timer = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  const handleEventClick = (clickInfo: EventClickArg) => {
    const event = events.find(e => e.title === clickInfo.event.title);
    if (event) {
      setSelectedEvent(event);
    }
  };

  const handlePrevious = () => {
    const calendarApi = calendarRef.current?.getApi();
    calendarApi?.prev();
  };

  const handleNext = () => {
    const calendarApi = calendarRef.current?.getApi();
    calendarApi?.next();
  };

  const handleToday = () => {
    const calendarApi = calendarRef.current?.getApi();
    calendarApi?.today();
  };

  const toggleView = () => {
    const newView = view === 'dayGridMonth' ? 'listWeek' : 'dayGridMonth';
    setView(newView);
    const calendarApi = calendarRef.current?.getApi();
    calendarApi?.changeView(newView);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-7xl mx-auto">
          <Card className="animate-pulse">
            <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
              <div className="h-8 bg-white/20 rounded w-1/3"></div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="h-96 bg-gray-200 rounded"></div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        <Card className="shadow-lg">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
            <CardTitle className="text-2xl font-bold">{title}</CardTitle>
            <CardDescription className="text-blue-100">
              {events.length} events • Pull down to refresh
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="border-b bg-gray-50 p-4">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrevious}
                    className="h-9"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNext}
                    className="h-9"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleToday}
                    className="h-9"
                  >
                    Today
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleView}
                  className="h-9"
                >
                  {view === 'dayGridMonth' ? (
                    <>
                      <List className="h-4 w-4 mr-2" />
                      List View
                    </>
                  ) : (
                    <>
                      <Calendar className="h-4 w-4 mr-2" />
                      Calendar View
                    </>
                  )}
                </Button>
              </div>
            </div>
            <div className="p-4">
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, listPlugin, interactionPlugin]}
                initialView={view}
                headerToolbar={false}
                events={events.map(event => ({
                  title: event.title,
                  start: event.start,
                  end: event.end,
                  allDay: event.allDay,
                  extendedProps: {
                    description: event.description,
                    location: event.location
                  }
                }))}
                eventClick={handleEventClick}
                height="auto"
                dayMaxEvents={3}
                moreLinkClick="popover"
                eventClassNames="cursor-pointer"
                dayCellClassNames="hover:bg-gray-50 transition-colors"
                eventDisplay="block"
              />
            </div>
          </CardContent>
        </Card>

        {/* Event Details Modal */}
        {selectedEvent && (
          <div 
            className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
            onClick={() => setSelectedEvent(null)}
          >
            <Card 
              className="max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <CardHeader>
                <CardTitle>{selectedEvent.title}</CardTitle>
                <CardDescription>
                  {format(new Date(selectedEvent.start), 'PPP')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedEvent.location && (
                  <p className="text-sm text-gray-600 mb-2">
                    📍 {selectedEvent.location}
                  </p>
                )}
                {selectedEvent.description && (
                  <p className="text-sm text-gray-700">
                    {selectedEvent.description}
                  </p>
                )}
                <Button
                  className="w-full mt-4"
                  onClick={() => setSelectedEvent(null)}
                >
                  Close
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};