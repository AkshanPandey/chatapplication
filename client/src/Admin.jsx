import React, { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000'

export default function Admin({ currentUser, users }){
  const [newUserName, setNewUserName] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showTransferConfirm, setShowTransferConfirm] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)

  async function approve(id){ 
    if (!currentUser || currentUser.role !== 'admin') {
      alert('Only admin can approve users');
      return;
    }
    await fetch(`${SERVER}/api/users/approve`,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({id})
    }); 
    location.reload() 
  }

  async function reject(id){ 
    if (!currentUser || currentUser.role !== 'admin') {
      alert('Only admin can reject users');
      return;
    }
    await fetch(`${SERVER}/api/users/reject`,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({id})
    }); 
    location.reload() 
  }

  async function transferAdmin(userId) {
    if (!currentUser || currentUser.role !== 'admin') {
      alert('Only admin can transfer admin rights');
      return;
    }
    
    try {
      const response = await fetch(`${SERVER}/api/transfer-admin`, {
        method: 'POST',
        headers: { 
          'content-type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ 
          currentAdminId: currentUser.id,
          newAdminId: userId 
        })
      });
      
      const data = await response.json();
      if (data.ok) {
        const currentAdmin = JSON.parse(localStorage.getItem('qc_user'));
        currentAdmin.role = 'user';
        localStorage.setItem('qc_user', JSON.stringify(currentAdmin));
        alert('Admin rights transferred successfully. You will now be logged out.');
        localStorage.removeItem('qc_user');
        location.reload();
      } else {
        alert(data.error || 'Failed to transfer admin rights');
      }
    } catch (error) {
      console.error('Error transferring admin rights:', error);
      alert('Failed to transfer admin rights. Please try again.');
    }
  }

  function handleTransferClick(user) {
    setSelectedUser(user);
    setShowTransferConfirm(true);
  }

  function confirmTransfer() {
    if (selectedUser) {
      transferAdmin(selectedUser.id);
      setShowTransferConfirm(false);
      setSelectedUser(null);
    }
  }
  
  function handleLogout() {
    localStorage.removeItem('qc_user');
    location.reload();
  }

  async function addUser(e) {
    e.preventDefault();
    if (!newUserName.trim()) {
      alert('Please enter a username');
      return;
    }
    
    setIsLoading(true);
    const id = uuidv4();
    
    try {
      const response = await fetch(`${SERVER}/api/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, name: newUserName.trim() })
      });
      
      const data = await response.json();
      if (data.ok) {
        setNewUserName('');
        location.reload();
      } else {
        alert(data.error || 'Failed to add user');
      }
    } catch (error) {
      console.error('Error adding user:', error);
      alert('Failed to add user. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="center">
      <div className="card admin-card">
        <div className="admin-header">
          <h4>Admin Dashboard : {currentUser.name}</h4>
          <div className="admin-actions">
            <button onClick={() => location.hash = '#chat'} className="chat-btn">Open Chat</button>
            <button onClick={handleLogout} className="logout-btn">Logout</button>
          </div>
        </div>

        <form onSubmit={addUser} className="add-user-form">
          <h4>Add New User</h4>
          <div className="input-group">
            <input
              type="text"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              placeholder="Enter user name"
            />
            <button type="submit" className="add-btn">Add User</button>
          </div>
        </form>

        <h4>Pending</h4>
        <ul className="user-list">
          {users.filter(u=>u.status==='pending').map(u=>(
            <li key={u.id} className="user-item">
              {u.name}
              <div className="action-buttons">
                <button onClick={()=>approve(u.id)} className="approve-btn">Approve</button>
                <button onClick={()=>reject(u.id)} className="reject-btn">Reject</button>
              </div>
            </li>
          ))}
        </ul>
        
        <h4>Approved Users</h4>
        <ul className="user-list">
          {users.filter(u=>u.status==='approved' && u.id !== currentUser.id).map(u=>(
            <li key={u.id} className="user-item">
              <div className="user-info">
                <span className="user-name">{u.name}</span>
                <span className="user-role">{u.role}</span>
              </div>
              <button 
                onClick={() => handleTransferClick(u)} 
                className="transfer-admin-btn"
              >
                Make Admin
              </button>
            </li>
          ))}
        </ul>

        {showTransferConfirm && (
          <div className="modal-overlay">
            <div className="modal">
              <h3>Transfer Admin Rights</h3>
              <p>Are you sure you want to make {selectedUser?.name} the new admin? You will be logged out and become a regular user.</p>
              <div className="modal-actions">
                <button onClick={confirmTransfer} className="confirm-btn">Yes, Transfer</button>
                <button 
                  onClick={() => {
                    setShowTransferConfirm(false);
                    setSelectedUser(null);
                  }} 
                  className="cancel-btn"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
