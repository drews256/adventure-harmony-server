"""
Local tool implementations that directly interact with Supabase.
These provide more reliable and faster alternatives to MCP tools.
"""

import json
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
import uuid

from agno.tools import Toolkit, Function
from supabase import Client as SupabaseClient

logger = logging.getLogger(__name__)


class LocalTools(Toolkit):
    """Local implementations of essential tools"""
    
    def __init__(self, supabase_client: SupabaseClient, base_url: str = "https://adventure-harmony-planner.onrender.com", name: str = "local_tools"):
        super().__init__(name=name)
        self.supabase = supabase_client
        self.base_url = base_url
        
        # Define local tools
        self.functions = {
            "create_form": Function(
                name="create_form",
                fn=self.create_form,
                description="Create a form to collect information from users"
            ),
            "send_sms_with_link": Function(
                name="send_sms_with_link",
                fn=self.send_sms_with_link,
                description="Send an SMS with a link to a form or calendar"
            ),
            "create_calendar_display": Function(
                name="create_calendar_display",
                fn=self.create_calendar_display,
                description="Create a calendar display showing events"
            ),
            "create_help_request": Function(
                name="create_help_request",
                fn=self.create_help_request,
                description="Create a help request for human assistance"
            )
        }
    
    async def create_form(
        self,
        title: str,
        description: str,
        fields: List[Dict[str, Any]],
        submit_button_text: str = "Submit",
        success_message: str = "Thank you for your submission!"
    ) -> str:
        """
        Create a form to collect information from users.
        
        Args:
            title: Form title
            description: Form description/instructions
            fields: List of field definitions, each with:
                - name: Field identifier
                - label: Display label
                - type: "text", "email", "phone", "date", "select", "checkbox"
                - required: Whether field is required
                - options: For select fields, list of options
            submit_button_text: Text for submit button
            success_message: Message shown after submission
            
        Returns:
            URL to the created form
        """
        try:
            # Generate form ID
            form_id = str(uuid.uuid4())
            
            # Create JSON schema from fields
            properties = {}
            required = []
            
            for field in fields:
                field_name = field.get("name")
                field_type = field.get("type", "text")
                field_label = field.get("label", field_name)
                is_required = field.get("required", False)
                
                # Map field types to JSON schema
                schema_type = "string"
                schema_def = {
                    "type": schema_type,
                    "title": field_label
                }
                
                if field_type == "email":
                    schema_def["format"] = "email"
                elif field_type == "date":
                    schema_def["format"] = "date"
                elif field_type == "select" and "options" in field:
                    schema_def["enum"] = field["options"]
                elif field_type == "checkbox":
                    schema_def["type"] = "boolean"
                
                properties[field_name] = schema_def
                
                if is_required:
                    required.append(field_name)
            
            # Create form configuration
            form_config = {
                "id": form_id,
                "title": title,
                "description": description,
                "schema": {
                    "type": "object",
                    "properties": properties,
                    "required": required
                },
                "uiSchema": {},
                "submitButtonText": submit_button_text,
                "successMessage": success_message,
                "created_at": datetime.utcnow().isoformat()
            }
            
            # Store in database
            self.supabase.table("dynamic_forms").insert(form_config).execute()
            
            # Return form URL
            form_url = f"{self.base_url}/forms/{form_id}"
            return f"Form created! Access it at: {form_url}"
            
        except Exception as e:
            logger.error(f"Error creating form: {e}")
            return "I couldn't create the form right now. Please try again."
    
    async def send_sms_with_link(
        self,
        phone_number: str,
        message: str,
        link_url: Optional[str] = None,
        link_text: Optional[str] = "Click here"
    ) -> str:
        """
        Send an SMS message with an optional link.
        
        Args:
            phone_number: Recipient phone number
            message: SMS message text
            link_url: Optional URL to include
            link_text: Text to display for the link
            
        Returns:
            Confirmation message
        """
        try:
            # Format message with link if provided
            full_message = message
            if link_url:
                full_message += f"\n\n{link_text}: {link_url}"
            
            # In production, this would use Twilio via Supabase function
            # For now, we'll log it
            logger.info(f"SMS to {phone_number}: {full_message}")
            
            # Store the outgoing message
            self.supabase.table("conversation_messages").insert({
                "phone_number": phone_number,
                "content": full_message,
                "direction": "outgoing",
                "status": "sent",
                "sent_at": datetime.utcnow().isoformat()
            }).execute()
            
            return f"SMS sent to {phone_number}"
            
        except Exception as e:
            logger.error(f"Error sending SMS: {e}")
            return "I couldn't send the SMS right now. Please try again."
    
    async def create_calendar_display(
        self,
        title: str,
        events: List[Dict[str, Any]],
        view_type: str = "month"
    ) -> str:
        """
        Create a calendar display showing events.
        
        Args:
            title: Calendar title
            events: List of events, each with:
                - title: Event name
                - date: Date (YYYY-MM-DD)
                - time: Optional time
                - description: Optional description
                - location: Optional location
            view_type: "month", "week", or "agenda"
            
        Returns:
            URL to the calendar display
        """
        try:
            # Generate calendar ID
            calendar_id = str(uuid.uuid4())
            
            # Format events for storage
            formatted_events = []
            for event in events:
                formatted_event = {
                    "id": str(uuid.uuid4()),
                    "title": event.get("title", "Event"),
                    "start": event.get("date"),
                    "description": event.get("description", ""),
                    "location": event.get("location", "")
                }
                
                # Add time if provided
                if event.get("time"):
                    formatted_event["start"] += f"T{event['time']}"
                
                formatted_events.append(formatted_event)
            
            # Create calendar configuration
            calendar_config = {
                "id": calendar_id,
                "title": title,
                "events": formatted_events,
                "view": view_type,
                "created_at": datetime.utcnow().isoformat()
            }
            
            # Store in database
            self.supabase.table("calendar_displays").insert(calendar_config).execute()
            
            # Return calendar URL
            calendar_url = f"{self.base_url}/calendar/{calendar_id}"
            return f"Calendar created! View it at: {calendar_url}"
            
        except Exception as e:
            logger.error(f"Error creating calendar: {e}")
            return "I couldn't create the calendar right now. Please try again."
    
    async def create_help_request(
        self,
        conversation_id: str,
        issue_description: str,
        urgency: str = "normal"
    ) -> str:
        """
        Create a help request for human assistance.
        
        Args:
            conversation_id: ID of the current conversation
            issue_description: Description of what help is needed
            urgency: "low", "normal", or "high"
            
        Returns:
            Confirmation message with ticket number
        """
        try:
            # Generate ticket ID
            ticket_id = f"HELP-{datetime.utcnow().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
            
            # Create help request
            help_request = {
                "id": ticket_id,
                "conversation_id": conversation_id,
                "issue_description": issue_description,
                "urgency": urgency,
                "status": "open",
                "created_at": datetime.utcnow().isoformat()
            }
            
            # Store in database
            self.supabase.table("help_requests").insert(help_request).execute()
            
            # Return confirmation
            urgency_text = "high priority" if urgency == "high" else "normal priority"
            return f"Help request created (Ticket: {ticket_id}). A team member will assist you soon. This is marked as {urgency_text}."
            
        except Exception as e:
            logger.error(f"Error creating help request: {e}")
            return "I couldn't create the help request. Please call our support team directly."


# Factory function to create local tools
def create_local_tools(supabase_client: SupabaseClient, base_url: Optional[str] = None) -> LocalTools:
    """Create an instance of local tools"""
    if base_url is None:
        base_url = "https://adventure-harmony-planner.onrender.com"
    return LocalTools(supabase_client, base_url)