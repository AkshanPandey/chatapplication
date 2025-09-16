import React, { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import Chat from './Chat'
import Admin from './Admin'

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000'

export default function App(){
  const [user, setUser] = useState(null)
  const [users, setUsers] = useState([])
  const [name, setName] = useState('')
  const [isExistingUser, setIsExistingUser] = useState(false)

  useEffect(()=>{ 
    const s = localStorage.getItem('qc_user'); 
    if(s) setUser(JSON.parse(s)); 
    fetchUsers(); 
    const iv = setInterval(fetchUsers,3000); 
    return ()=>clearInterval(iv) 
  },[])

  // Check if user exists when name changes
  useEffect(() => {
    if (name.trim()) {
      const existingUser = users.find(u => u.name.toLowerCase() === name.trim().toLowerCase());
      setIsExistingUser(existingUser !== undefined);
    } else {
      setIsExistingUser(false);
    }
  }, [name, users]);

  async function fetchUsers(){
    try{
      const r = await fetch(`${SERVER}/api/users`)
      const j = await r.json()
      if(j.ok) setUsers(j.users)
    }catch(e){}
  }

  async function handleSubmit(){
    const trimmedName = name.trim();
    if(!trimmedName) return alert('Please enter a name');

    try {
      // Always try to register/login with the name
      const id = uuidv4();
      const response = await fetch(`${SERVER}/api/register`, { 
        method:'POST', 
        headers:{
          'content-type':'application/json',
          'Accept': 'application/json'
        }, 
        body:JSON.stringify({ id, name: trimmedName })
      });
      
      const data = await response.json();
      if(data.ok){ 
        // If user exists or was created successfully
        setUser(data.user); 
        localStorage.setItem('qc_user', JSON.stringify(data.user));
      } else {
        alert(data.error || 'Failed to register/login');
      }
    } catch (error) {
      console.error('Login/Register error:', error);
      alert('Failed to login/register. Please try again.');
    }
  }

  if(!user){
    return (
      <div className="center">
        <div className="card">
          <h3>Quick Chat</h3>
          <input 
            value={name} 
            onChange={e => setName(e.target.value)} 
            placeholder="Your name"
            className={isExistingUser ? 'input-recognized' : ''}
          />
          <button 
            onClick={handleSubmit}
            className={isExistingUser ? 'btn-login' : 'btn-register'}
          >
            {isExistingUser ? 'Login' : 'Register'}
          </button>
        </div>
      </div>
    )
  }

  const isAdmin = user.role === 'admin'
  
  function handleBackToLogin() {
    localStorage.removeItem('qc_user');
    setUser(null);
    setName('');
  }

  if(user.status==='pending') {
    return (
      <div className="center">
        <div className="card pending-card">
          <h3>Pending approval</h3>
          <p>Please wait for an admin to approve your account.</p>
          <button onClick={handleBackToLogin} className="back-btn">
            ← Back to Login
          </button>
        </div>
      </div>
    );
  }
  
  if(isAdmin && location.hash !== '#chat') {
    return <Admin currentUser={user} users={users} />
  }
  
  return <Chat currentUser={user} />
}
