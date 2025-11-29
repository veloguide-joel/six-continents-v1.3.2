// Authentication UI Components
class AuthUI {
    constructor() {
        this.createAuthModal();
    }

    createAuthModal() {
        // Remove existing modal if it exists
        const existingModal = document.getElementById('auth-modal');
        if (existingModal) {
            existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'auth-modal';
        modal.className = 'auth-modal';
        modal.innerHTML = `
            <div class="auth-modal-content">
                <div class="auth-header">
                    <h2 id="auth-title">Sign In to Sync Progress</h2>
                    <button class="auth-close" onclick="authUI.closeModal()">&times;</button>
                </div>
                
                <div class="auth-tabs">
                    <button class="auth-tab active" onclick="authUI.showTab('signin')">Sign In</button>
                    <button class="auth-tab" onclick="authUI.showTab('signup')">Sign Up</button>
                </div>

                <div id="auth-signin" class="auth-form active">
                    <div class="social-auth">
                        <button class="google-btn" onclick="authUI.signInWithGoogle()">
                            <svg width="18" height="18" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                            </svg>
                            Continue with Google
                        </button>
                    </div>
                    
                    <div class="auth-divider">
                        <span>or</span>
                    </div>
                    
                    <form onsubmit="authUI.handleSignIn(event)">
                        <input type="email" id="signin-email" placeholder="Email" required>
                        <input type="password" id="signin-password" placeholder="Password" required>
                        <button type="submit" class="auth-btn primary">Sign In</button>
                    </form>
                    
                    <p class="auth-link">
                        <a href="#" onclick="authUI.showForgotPassword()">Forgot your password?</a>
                    </p>
                </div>

                <div id="auth-signup" class="auth-form">
                    <div class="social-auth">
                        <button class="google-btn" onclick="authUI.signUpWithGoogle()">
                            <svg width="18" height="18" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                            </svg>
                            Sign up with Google
                        </button>
                    </div>
                    
                    <div class="auth-divider">
                        <span>or</span>
                    </div>
                    
                    <form onsubmit="authUI.handleSignUp(event)">
                        <input type="text" id="signup-name" placeholder="Full Name" required>
                        <input type="email" id="signup-email" placeholder="Email" required>
                        <input type="password" id="signup-password" placeholder="Password (min 6 characters)" required minlength="6">
                        <button type="submit" class="auth-btn primary">Create Account</button>
                    </form>
                </div>

                <div id="auth-forgot" class="auth-form">
                    <p>Enter your email address and we'll send you a link to reset your password.</p>
                    <form onsubmit="authUI.handleForgotPassword(event)">
                        <input type="email" id="forgot-email" placeholder="Email" required>
                        <button type="submit" class="auth-btn primary">Send Reset Link</button>
                    </form>
                    <p class="auth-link">
                        <a href="#" onclick="authUI.showTab('signin')">Back to Sign In</a>
                    </p>
                </div>

                <div id="auth-message" class="auth-message"></div>
            </div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .auth-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                z-index: 10000;
                backdrop-filter: blur(5px);
            }

            .auth-modal.show {
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .auth-modal-content {
                background: white;
                border-radius: 12px;
                padding: 0;
                width: 90%;
                max-width: 400px;
                max-height: 90vh;
                overflow-y: auto;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
                animation: modalSlideIn 0.3s ease-out;
            }

            @keyframes modalSlideIn {
                from {
                    opacity: 0;
                    transform: translateY(-20px) scale(0.95);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            .auth-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 24px 24px 0 24px;
                border-bottom: 1px solid #eee;
                margin-bottom: 24px;
            }

            .auth-header h2 {
                margin: 0;
                font-size: 24px;
                font-weight: 600;
                color: #333;
            }

            .auth-close {
                background: none;
                border: none;
                font-size: 28px;
                cursor: pointer;
                color: #666;
                padding: 0;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 6px;
                transition: all 0.2s;
            }

            .auth-close:hover {
                background: #f5f5f5;
                color: #333;
            }

            .auth-tabs {
                display: flex;
                margin: 0 24px 24px 24px;
                background: #f8f9fa;
                border-radius: 8px;
                padding: 4px;
            }

            .auth-tab {
                flex: 1;
                padding: 12px;
                border: none;
                background: none;
                cursor: pointer;
                border-radius: 6px;
                font-weight: 500;
                transition: all 0.2s;
                color: #666;
            }

            .auth-tab.active {
                background: white;
                color: #333;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            }

            .auth-form {
                display: none;
                padding: 0 24px 24px 24px;
            }

            .auth-form.active {
                display: block;
            }

            .social-auth {
                margin-bottom: 20px;
            }

            .google-btn {
                width: 100%;
                padding: 12px 16px;
                border: 2px solid #e0e0e0;
                border-radius: 8px;
                background: white;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                font-weight: 500;
                font-size: 16px;
                color: #333;
                transition: all 0.2s;
            }

            .google-btn:hover {
                border-color: #4285F4;
                box-shadow: 0 2px 8px rgba(66, 133, 244, 0.2);
            }

            .auth-divider {
                text-align: center;
                margin: 20px 0;
                position: relative;
            }

            .auth-divider::before {
                content: '';
                position: absolute;
                top: 50%;
                left: 0;
                right: 0;
                height: 1px;
                background: #e0e0e0;
            }

            .auth-divider span {
                background: white;
                padding: 0 16px;
                color: #666;
                font-size: 14px;
            }

            .auth-form input {
                width: 100%;
                padding: 14px 16px;
                border: 2px solid #e0e0e0;
                border-radius: 8px;
                margin-bottom: 16px;
                font-size: 16px;
                transition: border-color 0.2s;
                box-sizing: border-box;
            }

            .auth-form input:focus {
                outline: none;
                border-color: #4285F4;
            }

            .auth-btn {
                width: 100%;
                padding: 14px;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
            }

            .auth-btn.primary {
                background: #4285F4;
                color: white;
            }

            .auth-btn.primary:hover {
                background: #3367d6;
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(66, 133, 244, 0.3);
            }

            .auth-link {
                text-align: center;
                margin-top: 16px;
            }

            .auth-link a {
                color: #4285F4;
                text-decoration: none;
                font-weight: 500;
            }

            .auth-link a:hover {
                text-decoration: underline;
            }

            .auth-message {
                margin: 16px 24px 0 24px;
                padding: 12px;
                border-radius: 6px;
                text-align: center;
                font-weight: 500;
                display: none;
            }

            .auth-message.success {
                background: #d4edda;
                color: #155724;
                border: 1px solid #c3e6cb;
            }

            .auth-message.error {
                background: #f8d7da;
                color: #721c24;
                border: 1px solid #f5c6cb;
            }

            .auth-message.info {
                background: #d1ecf1;
                color: #0c5460;
                border: 1px solid #bee5eb;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(modal);
    }

    showModal() {
        const modal = document.getElementById('auth-modal');
        modal.classList.add('show');
        this.showTab('signin');
    }

    closeModal() {
        const modal = document.getElementById('auth-modal');
        modal.classList.remove('show');
        this.clearMessage();
    }

    showTab(tab) {
        // Hide all forms
        document.querySelectorAll('.auth-form').forEach(form => {
            form.classList.remove('active');
        });
        
        // Remove active class from all tabs
        document.querySelectorAll('.auth-tab').forEach(tabBtn => {
            tabBtn.classList.remove('active');
        });

        // Show selected form and tab
        if (tab === 'signin') {
            document.getElementById('auth-signin').classList.add('active');
            document.querySelector('.auth-tab:first-child').classList.add('active');
            document.getElementById('auth-title').textContent = 'Sign In to Sync Progress';
        } else if (tab === 'signup') {
            document.getElementById('auth-signup').classList.add('active');
            document.querySelector('.auth-tab:last-child').classList.add('active');
            document.getElementById('auth-title').textContent = 'Create Account to Sync';
        }

        this.clearMessage();
    }

    showForgotPassword() {
        document.querySelectorAll('.auth-form').forEach(form => {
            form.classList.remove('active');
        });
        document.getElementById('auth-forgot').classList.add('active');
        document.getElementById('auth-title').textContent = 'Reset Password';
        this.clearMessage();
    }

    showMessage(message, type = 'info') {
        const messageEl = document.getElementById('auth-message');
        messageEl.textContent = message;
        messageEl.className = `auth-message ${type}`;
        messageEl.style.display = 'block';
    }

    clearMessage() {
        const messageEl = document.getElementById('auth-message');
        messageEl.style.display = 'none';
    }

    async signInWithGoogle() {
        try {
            this.showMessage('Redirecting to Google...', 'info');
            const { data, error } = await supabaseAuth.signInWithGoogle();
            if (error) throw error;
            // Redirect will happen automatically
        } catch (error) {
            console.error('Google sign in error:', error);
            this.showMessage(error.message || 'Failed to sign in with Google', 'error');
        }
    }

    async signUpWithGoogle() {
        // Same as sign in for Google OAuth
        await this.signInWithGoogle();
    }

    async handleSignIn(event) {
        event.preventDefault();
        const email = document.getElementById('signin-email').value;
        const password = document.getElementById('signin-password').value;

        try {
            this.showMessage('Signing in...', 'info');
            await supabaseAuth.signInWithEmail(email, password);
            this.showMessage('Sign in successful!', 'success');
            setTimeout(() => this.closeModal(), 1500);
        } catch (error) {
            console.error('Sign in error:', error);
            this.showMessage(error.message || 'Failed to sign in', 'error');
        }
    }

    async handleSignUp(event) {
        event.preventDefault();
        const name = document.getElementById('signup-name').value;
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;

        try {
            this.showMessage('Creating account...', 'info');
            const result = await supabaseAuth.signUpWithEmail(email, password, { full_name: name });
            
            // Since email confirmation is disabled, the user should be signed in immediately
            if (result.user && !result.user.email_confirmed_at) {
                // User created but not confirmed - this shouldn't happen with confirmation disabled
                this.showMessage('Account created successfully! You are now signed in.', 'success');
            } else {
                this.showMessage('Account created and signed in successfully!', 'success');
            }
            
            setTimeout(() => {
                this.closeModal();
            }, 2000);
        } catch (error) {
            console.error('Sign up error:', error);
            this.showMessage(error.message || 'Failed to create account', 'error');
        }
    }

    async handleForgotPassword(event) {
        event.preventDefault();
        const email = document.getElementById('forgot-email').value;

        try {
            this.showMessage('Sending reset link...', 'info');
            await supabaseAuth.resetPassword(email);
            this.showMessage('Password reset link sent! Check your email.', 'success');
            setTimeout(() => {
                this.showTab('signin');
            }, 3000);
        } catch (error) {
            console.error('Password reset error:', error);
            this.showMessage(error.message || 'Failed to send reset link', 'error');
        }
    }
}

// Initialize auth UI
const authUI = new AuthUI();