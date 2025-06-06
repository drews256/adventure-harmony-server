"""
Helper tools for OCTO API integration.
These tools simplify the complex OCTO API flow for the agent.
"""

import json
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

from agno.tools import Toolkit, Function

logger = logging.getLogger(__name__)


class OCTOHelperTools(Toolkit):
    """Tools to help the agent properly use the OCTO API"""
    
    def __init__(self, name: str = "octo_helper_tools"):
        super().__init__(name=name)
        
        # Cache for product data to help with unit IDs
        self.products_cache = {}
        self.last_availability_response = None
        
        # Define helper tools
        self.functions = {
            "parse_products_for_booking": Function(
                name="parse_products_for_booking",
                fn=self.parse_products_for_booking,
                description="Parse products response to extract booking information including unit IDs"
            ),
            "format_availability_request": Function(
                name="format_availability_request",
                fn=self.format_availability_request,
                description="Format a proper availability check request with correct unit structure"
            ),
            "format_booking_request": Function(
                name="format_booking_request",
                fn=self.format_booking_request,
                description="Format a proper booking request using availability response"
            ),
            "get_unit_ids_for_product": Function(
                name="get_unit_ids_for_product",
                fn=self.get_unit_ids_for_product,
                description="Get available unit IDs for a specific product"
            )
        }
    
    async def parse_products_for_booking(
        self,
        products_response: str,
        activity_type: Optional[str] = None
    ) -> str:
        """
        Parse products response and extract booking-relevant information.
        
        Args:
            products_response: JSON string of products from OCTO API
            activity_type: Optional filter for specific activity type
            
        Returns:
            Formatted summary with product IDs, option IDs, and unit IDs
        """
        try:
            products = json.loads(products_response) if isinstance(products_response, str) else products_response
            
            if not products:
                return "No products found."
            
            results = []
            for product in products[:5]:  # Limit to 5 for SMS brevity
                product_id = product.get('id', 'unknown')
                product_name = product.get('internalName', 'Unnamed product')
                
                # Cache product data
                self.products_cache[product_id] = product
                
                # Extract options and units
                options = product.get('options', [])
                if options:
                    option = options[0]  # Use first option for simplicity
                    option_id = option.get('id', 'unknown')
                    units = option.get('units', [])
                    
                    unit_info = []
                    for unit in units:
                        unit_id = unit.get('id')
                        unit_name = unit.get('internalName', 'Unknown')
                        if unit_id:
                            unit_info.append(f"{unit_name} (ID: {unit_id})")
                    
                    result = f"""
Product: {product_name}
- Product ID: {product_id}
- Option ID: {option_id}
- Available units: {', '.join(unit_info) if unit_info else 'None found'}"""
                    results.append(result)
            
            return "\n".join(results) + "\n\nUse these IDs for availability checks and bookings."
            
        except Exception as e:
            logger.error(f"Error parsing products: {e}")
            return f"Error parsing products: {str(e)}"
    
    async def format_availability_request(
        self,
        product_id: str,
        date_start: str,
        date_end: Optional[str] = None,
        adults: int = 1,
        children: int = 0,
        option_id: Optional[str] = None
    ) -> str:
        """
        Format a proper availability request with correct structure.
        
        Args:
            product_id: Product ID from products search
            date_start: Start date (YYYY-MM-DD)
            date_end: End date (optional, defaults to start date)
            adults: Number of adults
            children: Number of children
            option_id: Specific option ID (optional)
            
        Returns:
            JSON string for availability request
        """
        try:
            # Get cached product data
            product = self.products_cache.get(product_id)
            if not product:
                return "Error: Product not found. Please search products first."
            
            # Get first option if not specified
            options = product.get('options', [])
            if not options:
                return "Error: Product has no options available."
            
            if not option_id and options:
                option_id = options[0].get('id')
            
            # Find the option and get unit IDs
            selected_option = None
            for opt in options:
                if opt.get('id') == option_id:
                    selected_option = opt
                    break
            
            if not selected_option:
                selected_option = options[0]
            
            # Build units array
            units = []
            option_units = selected_option.get('units', [])
            
            # Find adult and child units
            adult_unit = None
            child_unit = None
            
            for unit in option_units:
                unit_name = unit.get('internalName', '').lower()
                if 'adult' in unit_name and not adult_unit:
                    adult_unit = unit.get('id')
                elif 'child' in unit_name and not child_unit:
                    child_unit = unit.get('id')
            
            # Use first unit as adult if no specific adult unit found
            if not adult_unit and option_units:
                adult_unit = option_units[0].get('id')
            
            if adults > 0 and adult_unit:
                units.append({
                    "id": adult_unit,
                    "quantity": adults
                })
            
            if children > 0 and child_unit:
                units.append({
                    "id": child_unit,
                    "quantity": children
                })
            
            # Build request
            request = {
                "productId": product_id,
                "optionId": option_id,
                "localDateStart": date_start,
                "localDateEnd": date_end or date_start,
                "units": units
            }
            
            return f"Availability request formatted:\n```json\n{json.dumps(request, indent=2)}\n```"
            
        except Exception as e:
            logger.error(f"Error formatting availability request: {e}")
            return f"Error formatting request: {str(e)}"
    
    async def format_booking_request(
        self,
        availability_response: str,
        customer_name: str,
        customer_email: str,
        customer_phone: str,
        selected_time: Optional[str] = None,
        notes: Optional[str] = None
    ) -> str:
        """
        Format a booking request using availability response.
        
        Args:
            availability_response: JSON response from availability check
            customer_name: Customer full name
            customer_email: Customer email
            customer_phone: Customer phone
            selected_time: Selected time slot (if multiple available)
            notes: Special requests
            
        Returns:
            JSON string for booking request
        """
        try:
            availability = json.loads(availability_response) if isinstance(availability_response, str) else availability_response
            
            # Handle array response
            if isinstance(availability, list) and availability:
                availability = availability[0]
            
            # Extract key fields
            availability_id = availability.get('availabilityId')
            if not availability_id:
                return "Error: No availabilityId found in response. Cannot create booking."
            
            # Get other required fields from cached data or response
            product_id = availability.get('productId')
            option_id = availability.get('optionId')
            local_date = availability.get('localDate')
            
            # Build booking request
            booking = {
                "productId": product_id,
                "optionId": option_id,
                "availabilityId": availability_id,
                "localDate": local_date,
                "contact": {
                    "fullName": customer_name,
                    "emailAddress": customer_email,
                    "phoneNumber": customer_phone
                },
                "units": availability.get('units', [])
            }
            
            if selected_time:
                booking["localTime"] = selected_time
                
            if notes:
                booking["notes"] = notes
            
            return f"Booking request formatted:\n```json\n{json.dumps(booking, indent=2)}\n```"
            
        except Exception as e:
            logger.error(f"Error formatting booking request: {e}")
            return f"Error formatting booking: {str(e)}"
    
    async def get_unit_ids_for_product(
        self,
        product_id: str
    ) -> str:
        """
        Get available unit IDs for a specific product.
        
        Args:
            product_id: Product ID to look up
            
        Returns:
            List of available unit IDs with descriptions
        """
        try:
            product = self.products_cache.get(product_id)
            if not product:
                return "Product not found. Please search products first."
            
            results = []
            options = product.get('options', [])
            
            for option in options:
                option_id = option.get('id', 'unknown')
                option_name = option.get('internalName', 'Unnamed option')
                units = option.get('units', [])
                
                unit_list = []
                for unit in units:
                    unit_id = unit.get('id')
                    unit_name = unit.get('internalName', 'Unknown')
                    unit_type = unit.get('type', '')
                    
                    pricing = unit.get('pricing', [])
                    price_info = ""
                    if pricing:
                        price = pricing[0].get('price', 0)
                        currency = pricing[0].get('currency', 'USD')
                        price_info = f" - ${price/100:.2f} {currency}"
                    
                    unit_list.append(f"  - {unit_name} (ID: {unit_id}){price_info}")
                
                result = f"Option: {option_name} (ID: {option_id})\n" + "\n".join(unit_list)
                results.append(result)
            
            return "\n\n".join(results) if results else "No units found for this product."
            
        except Exception as e:
            logger.error(f"Error getting unit IDs: {e}")
            return f"Error getting unit IDs: {str(e)}"


# Factory function
def create_octo_helper_tools() -> OCTOHelperTools:
    """Create an instance of OCTO helper tools"""
    return OCTOHelperTools()