// Supabase Configuration
import { createClient } from 'https://cdn.skypack.dev/@supabase/supabase-js@2';

const supabaseUrl = 'https://vlcjilzgntxweomnyfgd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsY2ppbHpnbnR4d2VvbW55ZmdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5MTM0MzUsImV4cCI6MjA3NzQ4OTQzNX0.MeIJpGfdAGqQwx9t0_Tdog9W-Z1cWX3z4cUffeoQW-c';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Authentication helpers
export class AuthManager {
    constructor() {
        this.user = null;
        this.isAuthenticated = false;
    }

    async init() {
        // Get current session
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            this.user = session.user;
            this.isAuthenticated = true;
        }

        // Listen for auth changes
        supabase.auth.onAuthStateChange((event, session) => {
            if (session) {
                this.user = session.user;
                this.isAuthenticated = true;
                this.onAuthChange(true);
            } else {
                this.user = null;
                this.isAuthenticated = false;
                this.onAuthChange(false);
            }
        });
    }

    onAuthChange(isAuthenticated) {
        // This will be overridden by the main app
        console.log('Auth state changed:', isAuthenticated);
    }

    async signUp(email, password) {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
        });
        return { data, error };
    }

    async signIn(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        return { data, error };
    }

    async signOut() {
        const { error } = await supabase.auth.signOut();
        return { error };
    }

    async resetPassword(email) {
        const { data, error } = await supabase.auth.resetPasswordForEmail(email);
        return { data, error };
    }
}

// Progress sync helpers
export class ProgressManager {
    constructor(userId) {
        this.userId = userId;
    }

    async saveProgress(solvedStages, firstRiddleSolved) {
        if (!this.userId) return { error: 'No user ID' };

        const { data, error } = await supabase
            .from('app_5bb89ee048_user_progress')
            .upsert({
                user_id: this.userId,
                solved_stages: solvedStages,
                first_riddle_solved: firstRiddleSolved,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id'
            });

        return { data, error };
    }

    async loadProgress() {
        if (!this.userId) return { data: null, error: 'No user ID' };

        const { data, error } = await supabase
            .from('app_5bb89ee048_activity_log')
            .select('solved_stages, first_riddle_solved')
            .eq('user_id', this.userId)
            .single();

        return { data, error };
    }

    async logActivity(stageName, stageNumber, riddleType = 'main') {
        if (!this.userId) return { error: 'No user ID' };

        const { data, error } = await supabase
            .from('app_5fe11f8255_activity_log')
            .insert({
                user_id: this.userId,
                stage_name: stageName,
                stage_number: stageNumber,
                riddle_type: riddleType,
                user_agent: navigator.userAgent,
                session_id: this.getSessionId()
            });

        return { data, error };
    }

    getSessionId() {
        let sessionId = sessionStorage.getItem('contest_session_id');
        if (!sessionId) {
            sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('contest_session_id', sessionId);
        }
        return sessionId;
    }
}
