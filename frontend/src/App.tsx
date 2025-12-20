import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { AppContent } from './components/AppContent';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <p>Loading...</p>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
}

function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <LanguageProvider>
                    <Routes>
                        <Route path="/login" element={<Login />} />
                        <Route path="/signup" element={<Signup />} />
                        <Route
                            path="/*"
                            element={
                                <ProtectedRoute>
                                    <AppContent />
                                </ProtectedRoute>
                            }
                        />
                    </Routes>
                </LanguageProvider>
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
