import React, { useEffect, useRef, useState } from 'react'
import io from 'socket.io-client'
import { v4 as uuidv4 } from 'uuid'
import EmojiPicker from 'emoji-picker-react'
import { Modal, Button, Alert } from 'react-bootstrap'
import 'bootstrap/dist/css/bootstrap.min.css'

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000'

export default function Chat({ currentUser }) {
  const [users, setUsers] = useState([])
  const [activeChat, setActiveChat] = useState(null)
  const [messages, setMessages] = useState({})  // roomId -> messages[]
  const [text, setText] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [replyTo, setReplyTo] = useState(null)
  const [fileUploading, setFileUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [userRooms, setUserRooms] = useState({}) // userId -> roomId
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [alert, setAlert] = useState(null) // For error messages
  
  const socketRef = useRef(null)
  const chatContainerRef = useRef(null)
  const fileInputRef = useRef(null)
  const userStorageUsed = useRef(0) // Track user's storage usage

  useEffect(() => {
    fetchUsers();
    const interval = setInterval(fetchUsers, 5000); // Poll for new users
    return () => clearInterval(interval);
  }, []);

  // Debug logging for messages
  useEffect(() => {
    if (activeChat) {
      console.log('Current messages for room', activeChat.roomId, ':', messages[activeChat.roomId] || []);
    }
  }, [messages, activeChat]);

  async function fetchUsers() {
    try {
      const r = await fetch(`${SERVER}/api/users`);
      const data = await r.json();
      if (data.ok) {
        setUsers(data.users.filter(u => u.status === 'approved' && u.id !== currentUser.id));
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  }

  useEffect(() => {
    socketRef.current = io(SERVER, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });
    
    // Listen for chat deletion confirmation
    socketRef.current.on('chats:deleted', () => {
      console.log('All chats deleted successfully');
    });
    
    socketRef.current.on('message', ({ roomId, msg }) => {
      // Handle new message
      setMessages(prev => ({
        ...prev,
        [roomId]: [...(prev[roomId] || []), msg]
      }));
      
      // Show notification if message is not from current user
      if (msg.from !== currentUser.id && (!activeChat || activeChat.roomId !== roomId)) {
        const sender = users.find(u => u.id === msg.from);
        showNotification(sender?.name || 'Someone', msg.text);
      }
    });

    socketRef.current.on('room:history', ({ roomId, history }) => {
      console.log('Received history for room:', roomId, history);
      setMessages(prev => ({
        ...prev,
        [roomId]: history || []
      }));
    });

    socketRef.current.on('message:deleted', ({ roomId, messageId, deleteFor }) => {
      setMessages(prev => ({
        ...prev,
        [roomId]: prev[roomId]?.map(msg => 
          msg.id === messageId 
            ? { ...msg, deletedFor: [...(msg.deletedFor || []), ...deleteFor] }
            : msg
        ) || []
      }));
    });

    return () => socketRef.current?.disconnect();
  }, [currentUser.id, users, activeChat]);

  function showNotification(sender, message) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`New message from ${sender}`, { body: message });
    } else if ('Notification' in window && Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification(`New message from ${sender}`, { body: message });
        }
      });
    }
  }

  async function deleteMessage(messageId, roomId = null, forEveryone = false) {
    const targetRoomId = roomId || activeChat?.roomId;
    if (!targetRoomId) return;
    
    try {
      const response = await fetch(`${SERVER}/api/messages/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId,
          roomId: targetRoomId,
          userId: currentUser.id,
          forEveryone
        })
      });
      
      const data = await response.json();
      if (!data.ok) {
        console.error('Failed to delete message');
        return false;
      }
      return true;
    } catch (error) {
      console.error('Failed to delete message:', error);
      return false;
    }
  }

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, activeChat]);

  function getRoomId(user1, user2) {
    return [user1.id, user2.id].sort().join('--');
  }

  function handleUserSelect(user) {
    const roomId = getRoomId(currentUser, user);
    setActiveChat({ user, roomId });
    // Close sidebar on mobile after selecting a user
    setIsSidebarOpen(false);
    // Store the room mapping
    setUserRooms(prev => ({
      ...prev,
      [user.id]: roomId
    }));
    // Join the room
    socketRef.current.emit('join', { roomId, user: currentUser });
  }

  // Join all user rooms on load
  useEffect(() => {
    if (socketRef.current && users.length > 0) {
      users.forEach(user => {
        const roomId = getRoomId(currentUser, user);
        setUserRooms(prev => ({
          ...prev,
          [user.id]: roomId
        }));
        socketRef.current.emit('join', { roomId, user: currentUser });
      });
    }
  }, [users, currentUser]);

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Check file size (1GB = 1024 * 1024 * 1024 bytes)
    const maxSize = 1024 * 1024 * 1024;
    if (file.size > maxSize) {
      alert('File size must be less than 1GB');
      return;
    }

    // Check user's total storage usage
    if (userStorageUsed.current + file.size > maxSize) {
      alert('You have exceeded your storage limit of 1GB');
      return;
    }

    setFileUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', currentUser.id);

    try {
      const response = await fetch(`${SERVER}/api/upload`, {
        method: 'POST',
        body: formData,
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        },
      });

      const data = await response.json();
      if (data.ok) {
        userStorageUsed.current += file.size;
        sendMessage(null, {
          type: 'file',
          fileName: file.name,
          fileSize: file.size,
          fileUrl: data.fileUrl,
        });
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload file');
    } finally {
      setFileUploading(false);
      setUploadProgress(0);
    }
  }

  function handleEmojiClick(emojiData) {
    setText(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
  }

  function handleReply(message) {
    setReplyTo(message);
    setText('');
  }

  function send(e) {
    e?.preventDefault();
    if ((!text.trim() && !replyTo) || !activeChat) return;
    
    sendMessage(text.trim());
  }

  function sendMessage(textContent, fileData = null) {
    const msg = {
      id: uuidv4(),
      from: currentUser.id,
      name: currentUser.name,
      text: textContent,
      ts: Date.now(),
      replyTo: replyTo ? {
        id: replyTo.id,
        text: replyTo.text,
        name: replyTo.name
      } : null,
      file: fileData
    };

    // Send message to the current room
    socketRef.current.emit('message', { 
      roomId: activeChat.roomId, 
      msg 
    });

    // Optimistically update UI
    setMessages(prev => ({
      ...prev,
      [activeChat.roomId]: [...(prev[activeChat.roomId] || []), msg]
    }));
    
    setText('');
    setReplyTo(null);
    
    // Scroll to bottom
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }

  function handleLogout() {
    setShowLogoutModal(true);
  }

  async function confirmLogout(clearChats) {
    if (clearChats) {
      try {
        let success = true;
        // Delete messages in each room using the existing delete message endpoint
        for (const roomId of Object.keys(messages)) {
          const roomMessages = messages[roomId] || [];
          // Only delete messages sent by current user
          const userMessages = roomMessages.filter(msg => msg.from === currentUser.id);
          
          // Delete each message
          for (const msg of userMessages) {
            const deleted = await deleteMessage(msg.id, roomId, true);
            if (!deleted) {
              success = false;
            }
          }
          
          if (userMessages.length > 0) {
            // Notify room about deletion only if there were messages
            socketRef.current.emit('message:deleteAll', {
              roomId,
              userId: currentUser.id
            });
          }
        }
        
        // Wait a moment for socket messages to propagate
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (!success) {
          console.warn('Some messages could not be deleted');
        }
      } catch (error) {
        console.error('Error deleting chats:', error);
      }
    }
    
    // Clear local state
    setUsers([]);
    setMessages({});
    setActiveChat(null);
    setShowLogoutModal(false);
    
    // Disconnect socket and logout
    socketRef.current.disconnect();
    localStorage.removeItem('qc_user');
    location.reload();
  }

  return (
    <div className="chat-container">
      {/* Mobile Menu Toggle */}
      <button 
        className="mobile-menu-toggle"
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
      >
        ☰
      </button>

      {/* Sidebar */}
      <div className={`chat-sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>Chats</h2>
          {currentUser.role === 'admin' && (
            <button onClick={() => location.hash = ''} className="admin-btn">
              Admin Panel
            </button>
          )}
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>

        {/* Logout Confirmation Modal */}
        <Modal show={showLogoutModal} onHide={() => setShowLogoutModal(false)} centered>
          <Modal.Header closeButton>
            <Modal.Title>Logout Confirmation</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>Would you like to delete your chats before logging out?</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => confirmLogout(false)}>
              Just Logout
            </Button>
            <Button variant="danger" onClick={() => confirmLogout(true)}>
              Delete Chats & Logout
            </Button>
            <Button variant="light" onClick={() => setShowLogoutModal(false)}>
              Cancel
            </Button>
          </Modal.Footer>
        </Modal>
        <div className="users-list">
          {users.map(user => (
            <div
              key={user.id}
              className={`user-item ${activeChat?.user.id === user.id ? 'active' : ''}`}
              onClick={() => handleUserSelect(user)}
            >
              <div className="user-avatar">{user.name[0].toUpperCase()}</div>
              <div className="user-info">
                <div className="user-name">{user.name}</div>
                <div className="user-status">{user.status}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="chat-main">
        {activeChat ? (
          <>
            <div className="chat-header">
              <div className="chat-partner">
                <div className="user-avatar">{activeChat.user.name[0].toUpperCase()}</div>
                <div className="user-name">{activeChat.user.name}</div>
              </div>
            </div>
            <div className="messages-container" ref={chatContainerRef}>
              {(messages[activeChat.roomId] || []).map(m => {
                // Skip messages deleted for current user
                if (m.deletedFor?.includes(currentUser.id)) return null;
                
                const isMyMessage = m.from === currentUser.id;
                return (
                  <div
                    key={m.id}
                    className={`message ${isMyMessage ? 'sent' : 'received'}`}
                  >
                    <div className="message-content">
                      {m.replyTo && (
                        <div className="reply-content">
                          <div className="reply-header">
                            Replying to {m.replyTo.name}
                          </div>
                          <div className="reply-text">{m.replyTo.text}</div>
                        </div>
                      )}
                      
                      {m.file ? (
                        <div className="file-content">
                          <a href={m.file.fileUrl} target="_blank" rel="noopener noreferrer">
                            <i className="file-icon"></i>
                            <span>{m.file.fileName}</span>
                            <span className="file-size">
                              {(m.file.fileSize / (1024 * 1024)).toFixed(2)} MB
                            </span>
                          </a>
                        </div>
                      ) : (
                        <div className="message-text">{m.text}</div>
                      )}

                      <div className="message-footer">
                        <span className="message-time">
                          {new Date(m.ts).toLocaleTimeString()}
                        </span>
                        <div className="message-buttons">
                          <Button 
                            variant="link" 
                            size="sm"
                            onClick={() => handleReply(m)}
                            className="reply-button"
                          >
                            Reply
                          </Button>
                          {isMyMessage && (
                            <Button 
                              variant="link" 
                              size="sm"
                              onClick={() => deleteMessage(m.id, true)}
                              className="delete-button"
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <form className="message-input" onSubmit={send}>
              {replyTo && (
                <div className="reply-preview">
                  <div className="reply-text">
                    Replying to {replyTo.name}: {replyTo.text}
                  </div>
                  <button 
                    type="button" 
                    className="cancel-reply" 
                    onClick={() => setReplyTo(null)}
                  >
                    ×
                  </button>
                </div>
              )}
              
              <div className="input-container">
                <button 
                  type="button" 
                  className="emoji-button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                >
                  😊
                </button>
                
                <input
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Type a message"
                />
                
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
                
                <button 
                  type="button"
                  className="attach-button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  📎
                </button>
                
                <button type="submit" className="send-button">
                  Send
                </button>
              </div>
              
              {showEmojiPicker && (
                <>
                  <div className="emoji-picker-overlay" onClick={() => setShowEmojiPicker(false)} />
                  <div className="emoji-picker-container">
                    <EmojiPicker
                      onEmojiClick={handleEmojiClick}
                      width="100%"
                      height="100%"
                      searchPlaceholder="Search emoji..."
                      previewConfig={{ showPreview: false }}
                    />
                  </div>
                </>
              )}
              
              {fileUploading && (
                <div className="upload-progress">
                  Uploading: {uploadProgress}%
                  <div 
                    className="progress-bar" 
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              )}
            </form>
          </>
        ) : (
          <div className="no-chat-selected">
            <h3>Select a chat to start messaging</h3>
          </div>
        )}
      </div>
    </div>
  )
}
