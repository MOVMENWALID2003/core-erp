import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './index.css';

type BoundaryState = {error: Error | null};

class RootErrorBoundary extends React.Component<React.PropsWithChildren, BoundaryState> {
	state: BoundaryState = {error: null};

	static getDerivedStateFromError(error: Error): BoundaryState {
		return {error};
	}

	componentDidCatch(error: Error, info: React.ErrorInfo) {
		console.error('CORE ERP renderer failed:', error, info.componentStack);
	}

	render() {
		if (this.state.error) {
			return (
				<main className="boot-error" dir="rtl" role="alert">
					<h1>تعذر تشغيل CORE ERP</h1>
					<p>حدث خطأ أثناء تحميل الشاشة. بياناتك المحلية لم يتم حذفها.</p>
					<pre>{this.state.error.message}</pre>
					<button type="button" onClick={() => window.location.reload()}>إعادة تشغيل التطبيق</button>
				</main>
			);
		}
		return this.props.children;
	}
}

const rootElement = document.getElementById('root');

if (!rootElement) {
	const fallback = document.createElement('main');
	fallback.className = 'boot-error';
	fallback.dir = 'rtl';
	fallback.textContent = 'تعذر العثور على مساحة تشغيل التطبيق. أعد تشغيل CORE ERP.';
	document.body.append(fallback);
	throw new Error('Missing #root element in index.html');
}

createRoot(rootElement).render(
	<React.StrictMode>
		<RootErrorBoundary>
			<App />
		</RootErrorBoundary>
	</React.StrictMode>,
);
