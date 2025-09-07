// Enhanced Anonymous Chat Client
class AnonymousChatClient {
    constructor() {
        this.socket = io();
        this.currentRoom = null;
        this.partnerId = null;
        this.partnerLocation = null;
        this.myLocation = null;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordingStartTime = null;
        this.typingTimer = null;
        this.isTyping = false;
        this.isMuted = false;
        this.isCameraOff = false;
        
        this.initializeApp();
    }

    async initializeApp() {
        this.setupSocketListeners();
        this.setupEventListeners();
        await this.getMyLocation();
        this.showScreen('welcome');
    }

    // Socket Event Listeners
    setupSocketListeners() {
        // Connection events
        this.socket.on('connect', () => {
            this.updateStatus('online', 'Online');
            this.showToast('Connected to server', 'success');
        });

        this.socket.on('disconnect', () => {
            this.updateStatus('offline', 'Offline');
            this.showToast('Disconnected from server', 'error');
        });

        // System events
        this.socket.on('joined-system', (data) => {
            console.log('Joined system:', data);
            this.myLocation = data.location;
            this.updateLocationDisplay();
        });

        this.socket.on('searching-partner', () => {
            this.updateStatus('searching', 'Searching...');
            this.showScreen('searching');
        });

        this.socket.on('partner-found', (data) => {
            console.log('Partner found:', data);
            this.currentRoom = data.roomId;
            this.partnerId = data.partnerId;
            this.partnerLocation = data.partnerInfo.location;
            this.updateStatus('online', 'Connected');
            this.updatePartnerInfo(data.partnerInfo);
            this.showScreen('chat');
            this.showToast('Connected with a new partner!', 'success');
        });

        this.socket.on('partner-disconnected', () => {
            this.showToast('Partner disconnected', 'warning');
            this.resetChat();
        });

        this.socket.on('chat-stopped', () => {
            this.resetChat();
        });

        // Message events
        this.socket.on('new-message', (message) => {
            this.displayMessage(message);
            this.playNotificationSound();
        });

        // Typing events
        this.socket.on('partner-typing-start', () => {
            this.showTypingIndicator();
        });

        this.socket.on('partner-typing-stop', () => {
            this.hideTypingIndicator();
        });

        // Call events
        this.socket.on('incoming-voice-call', (data) => {
            this.handleIncomingCall(data, 'voice');
        });

        this.socket.on('incoming-video-call', (data) => {
            this.handleIncomingCall(data, 'video');
        });

        this.socket.on('voice-call-accepted', () => {
            this.startCall('voice');
        });

        this.socket.on('video-call-accepted', () => {
            this.startCall('video');
        });

        this.socket.on('voice-call-rejected', () => {
            this.showToast('Call rejected', 'warning');
            this.hideCallModal();
        });

        this.socket.on('video-call-rejected', () => {
            this.showToast('Call rejected', 'warning');
            this.hideCallModal();
        });

        this.socket.on('voice-call-ended', () => {
            this.showToast('Call ended', 'info');
            this.endCall();
        });

        this.socket.on('video-call-ended', () => {
            this.showToast('Call ended', 'info');
            this.endCall();
        });

        // WebRTC events
        this.socket.on('webrtc-offer', (data) => {
            this.handleWebRTCOffer(data);
        });

        this.socket.on('webrtc-answer', (data) => {
            this.handleWebRTCAnswer(data);
        });

        this.socket.on('webrtc-ice-candidate', (data) => {
            this.handleWebRTCIceCandidate(data);
        });

        // Error handling
        this.socket.on('error', (data) => {
            console.error('Socket error:', data);
            this.showToast(data.message || 'An error occurred', 'error');
        });
    }

    // DOM Event Listeners
    setupEventListeners() {
        // Start chat button
        document.getElementById('start-chat-btn').addEventListener('click', () => {
            const nickname = document.getElementById('nickname-input').value.trim() || 'Anonymous';
            this.joinSystem(nickname);
        });

        // Cancel search button
        document.getElementById('cancel-search-btn').addEventListener('click', () => {
            this.stopChat();
        });

        // End chat button
        document.getElementById('end-chat-btn').addEventListener('click', () => {
            this.stopChat();
        });

        // Message input
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');

        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        messageInput.addEventListener('input', () => {
            this.handleTyping();
        });

        sendBtn.addEventListener('click', () => {
            this.sendMessage();
        });

        // Media buttons
        document.getElementById('attach-file-btn').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });

        document.getElementById('camera-btn').addEventListener('click', () => {
            document.getElementById('camera-input').click();
        });

        document.getElementById('voice-record-btn').addEventListener('click', () => {
            this.toggleVoiceRecording();
        });

        // File inputs
        document.getElementById('file-input').addEventListener('change', (e) => {
            this.handleFileSelect(e);
        });

        document.getElementById('camera-input').addEventListener('change', (e) => {
            this.handleFileSelect(e);
        });

        // Call buttons
        document.getElementById('voice-call-btn').addEventListener('click', () => {
            this.initiateCall('voice');
        });

        document.getElementById('video-call-btn').addEventListener('click', () => {
            this.initiateCall('video');
        });

        // Call modal buttons
        document.getElementById('accept-call-btn').addEventListener('click', () => {
            this.acceptCall();
        });

        document.getElementById('decline-call-btn').addEventListener('click', () => {
            this.declineCall();
        });

        document.getElementById('hangup-btn').addEventListener('click', () => {
            this.endCall();
        });

        document.getElementById('mute-btn').addEventListener('click', () => {
            this.toggleMute();
        });

        document.getElementById('camera-toggle-btn').addEventListener('click', () => {
            this.toggleCamera();
        });

        // Nickname input enter key
        document.getElementById('nickname-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('start-chat-btn').click();
            }
        });
    }

    // Location Services
    async getMyLocation() {
        try {
            const response = await fetch('/get-location');
            const data = await response.json();
            
            if (data.success) {
                this.myLocation = data.location;
                this.updateLocationDisplay();
            }
        } catch (error) {
            console.error('Error getting location:', error);
            document.getElementById('location-display').innerHTML = `
                <i class="fas fa-map-marker-alt"></i>
                <span>Location unavailable</span>
            `;
        }
    }

    updateLocationDisplay() {
        const locationElement = document.getElementById('location-display');
        if (this.myLocation && locationElement) {
            let locationText = 'Your location: ';
            if (this.myLocation.city && this.myLocation.country) {
                locationText += `${this.myLocation.city}, ${this.myLocation.country}`;
            } else if (this.myLocation.country) {
                locationText += this.myLocation.country;
            } else {
                locationText += 'Unknown';
            }
            
            locationElement.innerHTML = `
                <i class="fas fa-map-marker-alt"></i>
                <span>${locationText}</span>
            `;
        }
    }

    // Core Chat Functions
    joinSystem(nickname) {
        this.socket.emit('join-system', { nickname });
    }

    findPartner() {
        this.socket.emit('find-partner');
    }

    stopChat() {
        this.socket.emit('stop-chat');
        this.resetChat();
    }

    sendMessage() {
        const messageInput = document.getElementById('message-input');
        const message = messageInput.value.trim();
        
        if (!message || !this.currentRoom) return;
        
        this.socket.emit('send-message', { message });
        messageInput.value = '';
        this.stopTyping();
    }

    // Message Display
    displayMessage(message) {
        const messagesContainer = document.getElementById('messages');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.senderId === this.socket.id ? 'sent' : 'received'} fade-in`;
        
        const timeStr = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let messageContent = '';
        
        switch(message.type) {
            case 'text':
                messageContent = `
                    <div class="message-content">
                        ${this.escapeHtml(message.content)}
                        <div class="message-time">${timeStr}</div>
                    </div>
                `;
                break;
                
            case 'voice':
                messageContent = `
                    <div class="message-content">
                        <div class="audio-message">
                            <audio controls>
                                <source src="${message.content}" type="audio/webm">
                                Your browser does not support audio playback.
                            </audio>
                            ${message.duration ? `<div class="duration">${Math.round(message.duration)}s</div>` : ''}
                        </div>
                        <div class="message-time">${timeStr}</div>
                    </div>
                `;
                break;
                
            case 'media':
                messageContent = this.createMediaMessageContent(message, timeStr);
                break;
        }
        
        messageElement.innerHTML = messageContent;
        messagesContainer.appendChild(messageElement);
        this.scrollToBottom();
    }

    createMediaMessageContent(message, timeStr) {
        let mediaHTML = '';
        
        switch(message.mediaType) {
            case 'image':
                mediaHTML = `
                    <div class="media-message">
                        <img src="${message.thumbnailUrl || message.content}" 
                             alt="${message.originalName}" 
                             onclick="this.src='${message.content}'; this.style.maxWidth='none'; this.style.maxHeight='400px';"
                             style="cursor: pointer; max-width: 250px; border-radius: 8px;">
                        <div class="file-info">
                            <div class="filename">${message.originalName}</div>
                            <div class="filesize">${this.formatFileSize(message.size)}</div>
                        </div>
                    </div>
                `;
                break;
                
            case 'video':
                mediaHTML = `
                    <div class="media-message">
                        <video controls style="max-width: 300px; border-radius: 8px;">
                            <source src="${message.content}" type="${message.mimetype}">
                            Your browser does not support video playback.
                        </video>
                        <div class="file-info">
                            <div class="filename">${message.originalName}</div>
                            <div class="filesize">${this.formatFileSize(message.size)}</div>
                        </div>
                    </div>
                `;
                break;
                
            case 'audio':
                mediaHTML = `
                    <div class="media-message">
                        <audio controls style="width: 100%; max-width: 300px;">
                            <source src="${message.content}" type="${message.mimetype}">
                            Your browser does not support audio playback.
                        </audio>
                        <div class="file-info">
                            <div class="filename">${message.originalName}</div>
                            <div class="filesize">${this.formatFileSize(message.size)}</div>
                        </div>
                    </div>
                `;
                break;
                
            default: // documents
                mediaHTML = `
                    <div class="media-message">
                        <a href="${message.content}" target="_blank" download="${message.originalName}" class="document-message">
                            <div class="document-icon">📄</div>
                            <div class="file-info">
                                <div class="filename">${message.originalName}</div>
                                <div class="filesize">${this.formatFileSize(message.size)}</div>
                            </div>
                        </a>
                    </div>
                `;
        }
        
        return `
            <div class="message-content">
                ${mediaHTML}
                <div class="message-time">${timeStr}</div>
            </div>
        `;
    }

    // File Handling
    async handleFileSelect(event) {
        const files = event.target.files;
        if (files.length === 0) return;

        this.showLoading(true);
        
        for (let file of files) {
            try {
                await this.uploadFile(file);
            } catch (error) {
                console.error('Error uploading file:', error);
                this.showToast(`Failed to upload ${file.name}`, 'error');
            }
        }
        
        this.showLoading(false);
        event.target.value = ''; // Reset input
    }

    async uploadFile(file) {
        const fileType = file.type;
        let endpoint = '/upload-media';
        
        if (fileType.startsWith('image/')) {
            endpoint = '/upload-image';
        }
        
        const formData = new FormData();
        formData.append(fileType.startsWith('image/') ? 'image' : 'media', file);

        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        
        if (data.success) {
            this.socket.emit('send-media-message', {
                mediaType: data.mediaType || 'image',
                url: data.url,
                thumbnailUrl: data.thumbnailUrl,
                filename: data.filename,
                originalName: data.originalName,
                size: data.size,
                mimetype: data.mimetype
            });
        } else {
            throw new Error(data.error || 'Upload failed');
        }
    }

    // Voice Recording
    async toggleVoiceRecording() {
        if (this.isRecording) {
            this.stopVoiceRecording();
        } else {
            await this.startVoiceRecording();
        }
    }

    async startVoiceRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            this.recordingStartTime = Date.now();
            this.isRecording = true;

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                const duration = (Date.now() - this.recordingStartTime) / 1000;
                await this.sendVoiceMessage(audioBlob, duration);
                
                // Stop all tracks
                stream.getTracks().forEach(track => track.stop());
            };

            this.mediaRecorder.start();
            this.updateRecordingUI(true);
            
        } catch (error) {
            console.error('Error starting voice recording:', error);
            this.showToast('Error accessing microphone', 'error');
        }
    }

    stopVoiceRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.updateRecordingUI(false);
        }
    }

    async sendVoiceMessage(audioBlob, duration = 0) {
        try {
            const formData = new FormData();
            formData.append('voice', audioBlob);

            const response = await fetch('/upload-voice', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            
            if (data.success) {
                this.socket.emit('send-voice-message', {
                    audioUrl: data.url,
                    duration: duration,
                    size: data.size
                });
            } else {
                throw new Error('Upload failed');
            }
        } catch (error) {
            console.error('Error uploading voice:', error);
            this.showToast('Failed to send voice message', 'error');
        }
    }

    // Typing Indicators
    handleTyping() {
        if (!this.isTyping) {
            this.isTyping = true;
            this.socket.emit('typing-start');
        }
        
        clearTimeout(this.typingTimer);
        this.typingTimer = setTimeout(() => {
            this.stopTyping();
        }, 1000);
    }

    stopTyping() {
        if (this.isTyping) {
            this.isTyping = false;
            this.socket.emit('typing-stop');
        }
        clearTimeout(this.typingTimer);
    }

    showTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        indicator.classList.remove('hidden');
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        indicator.classList.add('hidden');
    }

    // Call Functions
    initiateCall(type) {
        if (type === 'voice') {
            this.socket.emit('initiate-voice-call');
        } else {
            this.socket.emit('initiate-video-call');
        }
        this.showToast(`Calling partner...`, 'info');
    }

    handleIncomingCall(data, type) {
        this.currentCallType = type;
        this.currentCallerId = data.callerId;
        
        document.getElementById('caller-name').textContent = data.callerNickname;
        document.getElementById('call-type').textContent = `Incoming ${type} call`;
        
        this.showIncomingCall();
    }

    acceptCall() {
        if (this.currentCallType === 'voice') {
            this.socket.emit('accept-voice-call', { callerId: this.currentCallerId });
        } else {
            this.socket.emit('accept-video-call', { callerId: this.currentCallerId });
        }
        this.hideIncomingCall();
    }

    declineCall() {
        if (this.currentCallType === 'voice') {
            this.socket.emit('reject-voice-call', { callerId: this.currentCallerId });
        } else {
            this.socket.emit('reject-video-call', { callerId: this.currentCallerId });
        }
        this.hideCallModal();
    }

    async startCall(type) {
        try {
            const constraints = type === 'video' 
                ? { audio: true, video: true }
                : { audio: true };
                
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            if (type === 'video') {
                const localVideo = document.getElementById('local-video');
                localVideo.srcObject = this.localStream;
            }
            
            await this.setupPeerConnection();
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            this.socket.emit('webrtc-offer', { offer });
            
            this.showActiveCall();
            
        } catch (error) {
                        console.error('Error starting call:', error);
            this.showToast('Error starting call', 'error');
        }
    }

    endCall() {
        this.socket.emit('end-voice-call');
        this.socket.emit('end-video-call');
        this.cleanupCall();
        this.hideCallModal();
        this.showToast('Call ended', 'info');
    }

    toggleMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.isMuted = !audioTrack.enabled;
                
                const muteBtn = document.getElementById('mute-btn');
                if (this.isMuted) {
                    muteBtn.classList.add('muted');
                    muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
                } else {
                    muteBtn.classList.remove('muted');
                    muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
                }
            }
        }
    }

    toggleCamera() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.isCameraOff = !videoTrack.enabled;
                
                const cameraBtn = document.getElementById('camera-toggle-btn');
                if (this.isCameraOff) {
                    cameraBtn.classList.add('muted');
                    cameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
                } else {
                    cameraBtn.classList.remove('muted');
                    cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
                }
            }
        }
    }

    // WebRTC Functions
    async setupPeerConnection() {
        this.peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('webrtc-ice-candidate', { candidate: event.candidate });
            }
        };

        this.peerConnection.ontrack = (event) => {
            this.remoteStream = event.streams[0];
            
            const remoteVideo = document.getElementById('remote-video');
            if (remoteVideo) {
                remoteVideo.srcObject = this.remoteStream;
            }
        };

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
        }
    }

    async handleWebRTCOffer(data) {
        try {
            const constraints = { audio: true, video: true };
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            const localVideo = document.getElementById('local-video');
            if (localVideo) {
                localVideo.srcObject = this.localStream;
            }
            
            await this.setupPeerConnection();
            await this.peerConnection.setRemoteDescription(data.offer);
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            this.socket.emit('webrtc-answer', { answer });
            
            this.showActiveCall();
            
        } catch (error) {
            console.error('Error handling WebRTC offer:', error);
        }
    }

    async handleWebRTCAnswer(data) {
        try {
            await this.peerConnection.setRemoteDescription(data.answer);
        } catch (error) {
            console.error('Error handling WebRTC answer:', error);
        }
    }

    async handleWebRTCIceCandidate(data) {
        try {
            await this.peerConnection.addIceCandidate(data.candidate);
        } catch (error) {
            console.error('Error handling ICE candidate:', error);
        }
    }

    cleanupCall() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        // Clear video elements
        const localVideo = document.getElementById('local-video');
        const remoteVideo = document.getElementById('remote-video');
        
        if (localVideo) localVideo.srcObject = null;
        if (remoteVideo) remoteVideo.srcObject = null;
        
        // Reset button states
        this.isMuted = false;
        this.isCameraOff = false;
        
        const muteBtn = document.getElementById('mute-btn');
        const cameraBtn = document.getElementById('camera-toggle-btn');
        
        if (muteBtn) {
            muteBtn.classList.remove('muted');
            muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        }
        
        if (cameraBtn) {
            cameraBtn.classList.remove('muted');
            cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
        }
    }

    // UI Helper Functions
    showScreen(screenName) {
        const screens = ['welcome-screen', 'searching-screen', 'chat-screen'];
        
        screens.forEach(screen => {
            const element = document.getElementById(screen);
            if (element) {
                if (screen === `${screenName}-screen`) {
                    element.classList.remove('hidden');
                    element.classList.add('fade-in');
                } else {
                    element.classList.add('hidden');
                    element.classList.remove('fade-in');
                }
            }
        });

        // Special handling for chat screen initialization
        if (screenName === 'chat') {
            this.initializeChatScreen();
        }
    }

    initializeChatScreen() {
        // Clear previous messages
        const messagesContainer = document.getElementById('messages');
        messagesContainer.innerHTML = `
            <div class="system-message">
                <i class="fas fa-info-circle"></i>
                <span>You're now connected! Say hello to start the conversation.</span>
            </div>
        `;
        
        // Focus on message input
        setTimeout(() => {
            document.getElementById('message-input').focus();
        }, 300);
    }

    updateStatus(status, text) {
        const indicator = document.getElementById('status-indicator');
        const statusText = document.getElementById('status-text');
        
        if (indicator) {
            indicator.className = `status-indicator ${status}`;
        }
        
        if (statusText) {
            statusText.textContent = text;
        }
    }

    updatePartnerInfo(partnerInfo) {
        document.getElementById('partner-name').textContent = partnerInfo.nickname || 'Anonymous User';
        
        const locationElement = document.getElementById('partner-location');
        if (partnerInfo.location) {
            let locationText = '';
            if (partnerInfo.location.city && partnerInfo.location.country) {
                locationText = `${partnerInfo.location.city}, ${partnerInfo.location.country}`;
            } else if (partnerInfo.location.country) {
                locationText = partnerInfo.location.country;
            }
            
            if (partnerInfo.location.distance) {
                locationText += ` (${partnerInfo.location.distance} km away)`;
            }
            
            locationElement.innerHTML = `
                <i class="fas fa-map-marker-alt"></i>
                <span>${locationText || 'Location unknown'}</span>
            `;
        } else {
            locationElement.innerHTML = `
                <i class="fas fa-map-marker-alt"></i>
                <span>Location unknown</span>
            `;
        }
    }

    updateRecordingUI(isRecording) {
        const recordBtn = document.getElementById('voice-record-btn');
        
        if (isRecording) {
            recordBtn.classList.add('recording');
            recordBtn.innerHTML = '<i class="fas fa-stop"></i>';
            recordBtn.title = 'Stop Recording';
        } else {
            recordBtn.classList.remove('recording');
            recordBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            recordBtn.title = 'Record Voice';
        }
    }

    resetChat() {
        this.currentRoom = null;
        this.partnerId = null;
        this.partnerLocation = null;
        this.cleanupCall();
        this.updateStatus('online', 'Online');
        this.showScreen('welcome');
        
        // Stop any ongoing recording
        if (this.isRecording) {
            this.stopVoiceRecording();
        }
        
        // Clear typing states
        this.stopTyping();
        this.hideTypingIndicator();
    }

    // Modal Functions
    showCallModal() {
        document.getElementById('call-modal').classList.remove('hidden');
    }

    hideCallModal() {
        document.getElementById('call-modal').classList.add('hidden');
        this.hideIncomingCall();
        this.hideActiveCall();
    }

    showIncomingCall() {
        this.showCallModal();
        document.getElementById('incoming-call').classList.remove('hidden');
        document.getElementById('active-call').classList.add('hidden');
    }

    hideIncomingCall() {
        document.getElementById('incoming-call').classList.add('hidden');
    }

    showActiveCall() {
        this.showCallModal();
        document.getElementById('incoming-call').classList.add('hidden');
        document.getElementById('active-call').classList.remove('hidden');
    }

    hideActiveCall() {
        document.getElementById('active-call').classList.add('hidden');
    }

    showLoading(show) {
        const overlay = document.getElementById('loading-overlay');
        if (show) {
            overlay.classList.remove('hidden');
        } else {
            overlay.classList.add('hidden');
        }
    }

    // Toast Notifications
    showToast(message, type = 'info', title = null) {
        const toastContainer = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = 'fas fa-info-circle';
        switch(type) {
            case 'success':
                icon = 'fas fa-check-circle';
                break;
            case 'error':
                icon = 'fas fa-exclamation-circle';
                break;
            case 'warning':
                icon = 'fas fa-exclamation-triangle';
                break;
        }
        
        toast.innerHTML = `
            <div class="toast-icon">
                <i class="${icon}"></i>
            </div>
            <div class="toast-content">
                ${title ? `<div class="toast-title">${title}</div>` : ''}
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => {
            this.removeToast(toast);
        });
        
        toastContainer.appendChild(toast);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            this.removeToast(toast);
        }, 5000);
    }

    removeToast(toast) {
        if (toast && toast.parentNode) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => {
                toast.remove();
            }, 300);
        }
    }

    // Utility Functions
    scrollToBottom() {
        const container = document.getElementById('messages-container');
        setTimeout(() => {
            container.scrollTop = container.scrollHeight;
        }, 100);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    playNotificationSound() {
        // Create a simple notification sound
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0, audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (error) {
            // Fallback for browsers that don't support Web Audio API
            console.log('Notification sound not supported');
        }
    }
}

// Initialize the chat client when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const chatClient = new AnonymousChatClient();
    
    // Make it globally accessible for debugging
    window.chatClient = chatClient;
    
    // Handle page visibility changes
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Page is hidden
            console.log('Page hidden');
        } else {
            // Page is visible
            console.log('Page visible');
        }
    });
    
    // Handle window beforeunload
    window.addEventListener('beforeunload', (e) => {
        if (chatClient.currentRoom) {
            e.preventDefault();
            e.returnValue = 'You are currently in a chat. Are you sure you want to leave?';
            return e.returnValue;
        }
    });
    
    // Handle connection errors
    window.addEventListener('online', () => {
        chatClient.showToast('Connection restored', 'success');
    });
    
    window.addEventListener('offline', () => {
        chatClient.showToast('Connection lost', 'error');
    });
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + Enter to send message
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            if (chatClient.currentRoom) {
                chatClient.sendMessage();
            }
        }
        
        // Escape to end chat
        if (e.key === 'Escape') {
            if (chatClient.currentRoom) {
                chatClient.stopChat();
            }
        }
    });
    
    // Add drag and drop support for files
    const chatScreen = document.getElementById('chat-screen');
    
    chatScreen.addEventListener('dragover', (e) => {
        e.preventDefault();
        chatScreen.classList.add('drag-over');
    });
    
    chatScreen.addEventListener('dragleave', () => {
        chatScreen.classList.remove('drag-over');
    });
    
    chatScreen.addEventListener('drop', (e) => {
        e.preventDefault();
        chatScreen.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0 && chatClient.currentRoom) {
            const fileInput = document.getElementById('file-input');
            fileInput.files = files;
            chatClient.handleFileSelect({ target: fileInput });
        }
    });
    
    console.log('Anonymous Chat Client initialized successfully!');
});

// Add drag and drop styles
const style = document.createElement('style');
style.textContent = `
    .chat-screen.drag-over {
        background-color: rgba(99, 102, 241, 0.1);
        border: 2px dashed var(--primary-color);
    }
    
    .chat-screen.drag-over::after {
        content: "Drop files here to share";
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--primary-color);
        color: white;
        padding: 16px 24px;
        border-radius: var(--border-radius);
        font-weight: 600;
        pointer-events: none;
        z-index: 1000;
    }
`;
document.head.appendChild(style);
