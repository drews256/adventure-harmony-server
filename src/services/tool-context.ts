import type { ConversationJob } from '../types';
import { GoGuideAPIClient } from './goguide-api';

// Define contexts for different types of conversations
export enum ConversationContext {
  TRAVEL_PLANNING = 'travel_planning',
  BOOKING_ASSISTANCE = 'booking_assistance',
  AVAILABILITY_CHECK = 'availability_check',
  CUSTOMER_SUPPORT = 'customer_support',
  GENERAL = 'general'
}

// Map of contexts to relevant API categories
const contextToCategories: Record<ConversationContext, string[]> = {
  [ConversationContext.TRAVEL_PLANNING]: ['Listings', 'Availability', 'Products'],
  [ConversationContext.BOOKING_ASSISTANCE]: ['Orders', 'Customers', 'Payment'],
  [ConversationContext.AVAILABILITY_CHECK]: ['Availability', 'Schedules', 'Resources'],
  [ConversationContext.CUSTOMER_SUPPORT]: ['Correspondence', 'Orders', 'Customers'],
  [ConversationContext.GENERAL]: []
};

/**
 * Determines the context of a conversation based on message content
 */
export function determineConversationContext(messages: any[]): ConversationContext {
  // Join all user messages
  const userContent = messages
    .filter(m => m.role === 'user')
    .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
    .join(' ')
    .toLowerCase();
  
  // Check for context clues
  if (userContent.includes('book') || 
      userContent.includes('reserve') || 
      userContent.includes('payment')) {
    return ConversationContext.BOOKING_ASSISTANCE;
  }
  
  if (userContent.includes('available') || 
      userContent.includes('schedule') || 
      userContent.includes('open')) {
    return ConversationContext.AVAILABILITY_CHECK;
  }
  
  if (userContent.includes('trip') || 
      userContent.includes('travel') || 
      userContent.includes('vacation')) {
    return ConversationContext.TRAVEL_PLANNING;
  }
  
  if (userContent.includes('help') || 
      userContent.includes('issue') || 
      userContent.includes('problem')) {
    return ConversationContext.CUSTOMER_SUPPORT;
  }
  
  return ConversationContext.GENERAL;
}

/**
 * Gets relevant tool categories for a conversation context
 */
export function getRelevantCategories(context: ConversationContext): string[] {
  return contextToCategories[context] || [];
}

/**
 * Gets relevant tools for a job based on its context
 */
export async function getRelevantTools(job: ConversationJob, goGuideClient: GoGuideAPIClient): Promise<any[]> {
  const context = determineConversationContext(job.conversation_history);
  const categories = getRelevantCategories(context);
  
  // Pass the profile_id to get profile-specific tools
  return goGuideClient.getTools(categories, job.profile_id);
}