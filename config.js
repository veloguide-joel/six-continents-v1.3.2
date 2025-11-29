// FIXED: Environment configuration for browser deployment
// This file sets up environment variables from Vercel in the browser window object

(function() {
    // Check if we're in a browser environment
    if (typeof window !== 'undefined') {
        // Set Supabase configuration from environment variables or fallbacks
        window.SUPABASE_URL = window.NEXT_PUBLIC_SUPABASE_URL || 'https://vlcjilzgntxweomnyfgd.supabase.co';
        window.SUPABASE_ANON_KEY = window.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsY2ppbHpnbnR4d2VvbW55ZmdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5MTM0MzUsImV4cCI6MjA3NzQ4OTQzNX0.MeIJpGfdAGqQwx9t0_Tdog9W-Z1cWX3z4cUffeoQW-c';
        
        console.log('[CONFIG] Environment variables loaded:', {
            url: window.SUPABASE_URL,
            keyEnding: window.SUPABASE_ANON_KEY.slice(-10)
        });
    }
})();