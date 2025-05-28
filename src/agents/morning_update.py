"""
Morning Update functionality for the A2A worker
Sends scheduled business updates to users based on their profile settings
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta, time
from typing import Dict, Any, Optional, List
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ProfileSettings:
    """Profile settings for morning updates"""
    profile_id: str
    phone_number: str
    morning_update_enabled: bool = True
    morning_update_time: time = time(8, 0)  # Default 8 AM
    timezone: str = "America/Denver"  # Default Mountain Time
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ProfileSettings':
        """Create ProfileSettings from dictionary"""
        settings = data.get('morning_update_settings', {})
        
        # Parse time if it's a string
        update_time = settings.get('time', '08:00')
        if isinstance(update_time, str):
            hour, minute = map(int, update_time.split(':'))
            update_time = time(hour, minute)
        
        return cls(
            profile_id=data['profile_id'],
            phone_number=data['phone_number'],
            morning_update_enabled=settings.get('enabled', True),
            morning_update_time=update_time,
            timezone=settings.get('timezone', 'America/Denver')
        )


class MorningUpdateManager:
    """Manages morning updates for profiles"""
    
    def __init__(self, supabase_client, mcp_client):
        self.supabase = supabase_client
        self.mcp_client = mcp_client
        self.last_update_check = {}
        
    async def get_profile_settings(self, phone_number: str) -> Optional[ProfileSettings]:
        """Get profile settings for a phone number"""
        try:
            # First, try to get profile by phone number
            result = self.supabase.table("profiles").select("*").eq(
                "phone_number", phone_number
            ).execute()
            
            if result.data and len(result.data) > 0:
                return ProfileSettings.from_dict(result.data[0])
            
            # If no profile found, create default settings
            logger.info(f"No profile found for {phone_number}, using defaults")
            return ProfileSettings(
                profile_id="default",
                phone_number=phone_number
            )
            
        except Exception as e:
            logger.error(f"Error getting profile settings: {e}")
            return None
    
    async def should_send_update(self, settings: ProfileSettings) -> bool:
        """Check if we should send an update for this profile"""
        if not settings.morning_update_enabled:
            return False
        
        now = datetime.now()
        today_key = f"{settings.profile_id}:{now.date()}"
        
        # Check if we already sent today
        if today_key in self.last_update_check:
            return False
        
        # Check if it's the right time
        current_time = now.time()
        update_time = settings.morning_update_time
        
        # Allow 5 minute window
        time_diff = (
            current_time.hour * 60 + current_time.minute - 
            update_time.hour * 60 - update_time.minute
        )
        
        if 0 <= time_diff <= 5:
            self.last_update_check[today_key] = now
            return True
        
        return False
    
    async def gather_business_metrics(self, profile_id: str) -> Dict[str, Any]:
        """Gather business metrics using MCP tools"""
        metrics = {}
        
        try:
            # Get date range for yesterday
            end_date = datetime.now()
            start_date = end_date - timedelta(days=1)
            
            # Get bookings
            bookings_params = {
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat()
            }
            
            bookings_result = await self.mcp_client.call_tool("get_bookings", bookings_params)
            
            if bookings_result and "bookings" in bookings_result:
                bookings = bookings_result["bookings"]
                metrics["total_bookings"] = len(bookings)
                metrics["total_revenue"] = sum(float(b.get("total", 0)) for b in bookings)
                
                # Get top products
                product_counts = {}
                for booking in bookings:
                    for item in booking.get("items", []):
                        product_name = item.get("product_name", "Unknown")
                        product_counts[product_name] = product_counts.get(product_name, 0) + 1
                
                top_products = sorted(product_counts.items(), key=lambda x: x[1], reverse=True)[:3]
                metrics["top_products"] = [name for name, _ in top_products]
            else:
                metrics["total_bookings"] = 0
                metrics["total_revenue"] = 0
                metrics["top_products"] = []
            
            # Get upcoming bookings
            upcoming_start = end_date
            upcoming_end = upcoming_start + timedelta(days=7)
            
            upcoming_params = {
                "start_date": upcoming_start.isoformat(),
                "end_date": upcoming_end.isoformat()
            }
            
            upcoming_result = await self.mcp_client.call_tool("get_bookings", upcoming_params)
            
            if upcoming_result and "bookings" in upcoming_result:
                upcoming = upcoming_result["bookings"]
                metrics["upcoming_bookings"] = len(upcoming)
                metrics["upcoming_revenue"] = sum(float(b.get("total", 0)) for b in upcoming)
            else:
                metrics["upcoming_bookings"] = 0
                metrics["upcoming_revenue"] = 0
            
        except Exception as e:
            logger.error(f"Error gathering metrics: {e}")
            metrics["error"] = str(e)
        
        return metrics
    
    def format_update_message(self, metrics: Dict[str, Any]) -> str:
        """Format metrics into a concise SMS message"""
        if "error" in metrics:
            return "Good morning! Unable to fetch today's metrics. Please check the system."
        
        # Format the message
        lines = [
            f"☀️ Good morning! Your business update for {datetime.now().strftime('%m/%d')}:",
            ""
        ]
        
        # Yesterday's performance
        if metrics["total_bookings"] > 0:
            lines.append(f"📊 Yesterday: {metrics['total_bookings']} bookings, ${metrics['total_revenue']:.2f}")
            if metrics["top_products"]:
                lines.append(f"🏆 Top: {', '.join(metrics['top_products'][:2])}")
        else:
            lines.append("📊 Yesterday: No bookings")
        
        # Upcoming week
        if metrics["upcoming_bookings"] > 0:
            lines.append(f"📅 Next 7 days: {metrics['upcoming_bookings']} bookings, ${metrics['upcoming_revenue']:.2f}")
        else:
            lines.append("📅 Next 7 days: No bookings yet")
        
        # Add a motivational closer
        lines.append("")
        if metrics["total_bookings"] > 5:
            lines.append("🚀 Great momentum! Keep it up!")
        elif metrics["upcoming_bookings"] > 3:
            lines.append("📈 Busy week ahead!")
        else:
            lines.append("💪 Let's make today count!")
        
        return "\n".join(lines)
    
    async def send_morning_update(self, profile_id: str, phone_number: str) -> bool:
        """Send morning update to a profile"""
        try:
            logger.info(f"Sending morning update to profile {profile_id} ({phone_number})")
            
            # Gather metrics
            metrics = await self.gather_business_metrics(profile_id)
            
            # Format message
            message = self.format_update_message(metrics)
            
            # Store the outgoing message
            result = self.supabase.table("conversation_messages").insert({
                "profile_id": profile_id,
                "phone_number": phone_number,
                "direction": "outgoing",
                "content": message,
                "status": "completed",
                "metadata": {
                    "type": "morning_update",
                    "metrics": metrics,
                    "generated_at": datetime.now().isoformat()
                }
            }).execute()
            
            logger.info(f"Morning update sent successfully to {phone_number}")
            return True
            
        except Exception as e:
            logger.error(f"Error sending morning update: {e}")
            return False
    
    async def check_and_send_updates(self) -> int:
        """Check all profiles and send updates as needed"""
        sent_count = 0
        
        try:
            # Get all active profiles
            # For now, just check the specific phone number
            test_phone = "9709465380"
            
            settings = await self.get_profile_settings(test_phone)
            if settings and await self.should_send_update(settings):
                if await self.send_morning_update(settings.profile_id, settings.phone_number):
                    sent_count += 1
            
            # In the future, query all profiles:
            # result = self.supabase.table("profiles").select("*").execute()
            # for profile in result.data:
            #     settings = ProfileSettings.from_dict(profile)
            #     if await self.should_send_update(settings):
            #         if await self.send_morning_update(settings.profile_id, settings.phone_number):
            #             sent_count += 1
            
        except Exception as e:
            logger.error(f"Error checking profiles for updates: {e}")
        
        return sent_count