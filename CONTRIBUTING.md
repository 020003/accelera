# Contributing to Accelera

Thank you for your interest in contributing to Accelera! This guide will help you get started with contributing to our GPU monitoring and AI workload management platform.

## 🚀 Quick Start

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/accelera.git
   cd accelera
   ```
3. **Set up development environment** (see [Development Setup](#development-setup))
4. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
5. **Make your changes** and test them
6. **Commit your changes**:
   ```bash
   git commit -m "Add your descriptive commit message"
   ```
7. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```
8. **Open a Pull Request** on GitHub

## 🛠️ Development Setup

### Prerequisites
- Node.js 18+ and npm/yarn
- Python 3.8+ with pip
- Docker and Docker Compose (optional)
- NVIDIA GPU with drivers (for testing)

### Backend Setup
```bash
cd server
pip install -r requirements.txt
python app.py
```

### Frontend Setup
```bash
npm install
npm run dev
```

### Full Docker Setup
```bash
docker-compose up -d
```

## 📋 Types of Contributions

### 🐛 Bug Reports
- Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
- Include system information, steps to reproduce, and expected behavior
- Add screenshots or logs when applicable

### ✨ Feature Requests  
- Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
- Describe the problem you're trying to solve
- Explain the proposed solution and alternatives considered

### 💻 Code Contributions
- **Frontend**: React/TypeScript components, UI improvements, visualizations
- **Backend**: Python/Flask API endpoints, GPU monitoring, AI integrations
- **DevOps**: Docker improvements, deployment scripts, CI/CD
- **Documentation**: README updates, API docs, deployment guides

### 📚 Documentation
- Fix typos, improve clarity, add examples
- Create tutorials, guides, or video content
- Translate documentation (future)

## 🎯 Development Guidelines

### Code Style
- **Frontend**: Use TypeScript strict mode, follow existing patterns
- **Backend**: Follow PEP 8 for Python code
- **Comments**: Write clear, concise comments for complex logic
- **Tests**: Add tests for new features and bug fixes

### Commit Messages
Use conventional commits format:
```
type(scope): description

feat(dashboard): add GPU temperature alerts
fix(api): resolve topology parsing error
docs(readme): update installation instructions
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

### Pull Request Guidelines
- **Title**: Use conventional commit format
- **Description**: Explain what and why, not just how
- **Testing**: Describe how you tested your changes
- **Screenshots**: Include UI changes screenshots
- **Breaking Changes**: Clearly mark any breaking changes

## 🧪 Testing

### Frontend Tests
```bash
npm run test
npm run test:coverage
```

### Backend Tests  
```bash
cd server
pytest
pytest --cov=. --cov-report=html
```

### Integration Tests
```bash
# Start services
docker-compose up -d

# Run tests
npm run test:e2e
```

### Manual Testing
- Test on different browsers (Chrome, Firefox, Safari)
- Verify responsive design on mobile devices
- Test with different GPU configurations
- Validate API endpoints with various inputs

## 📊 Adding New Visualizations

Accelera welcomes new visualization contributions! Here's how to add them:

### 1. Frontend Component
```typescript
// src/components/YourVisualization.tsx
export function YourVisualization({ data }: { data: YourDataType }) {
  // Your visualization logic
}
```

### 2. Backend Data Endpoint
```python
# server/app.py
@app.route('/api/your-data')
def get_your_data():
    # Your data processing logic
    return jsonify(result)
```

### 3. Integration
- Add to main dashboard tabs
- Create data fetching hook
- Update API documentation
- Add responsive design support

### Popular Visualization Libraries
- **Recharts** - Already integrated, preferred for charts
- **Three.js** - For 3D visualizations (already used)
- **D3.js** - For custom interactive visualizations
- **Plotly.js** - For scientific/engineering plots

## 🤖 AI Platform Integrations

Help expand AI platform support:

### Currently Supported
- ✅ **Ollama** - Auto-discovery and monitoring

### Community Contributions Wanted
- **NVIDIA Triton** - Production inference server
- **TensorFlow Serving** - TensorFlow model deployment
- **PyTorch Serve** - PyTorch model serving
- **Hugging Face** - Model hub integration
- **Ray Serve** - Scalable ML model serving

### Integration Template
```python
# server/ai_integrations/your_platform.py
class YourPlatformIntegration:
    def discover(self, host: str) -> bool:
        """Check if platform is running on host"""
        pass
    
    def get_models(self) -> List[Model]:
        """Get available models"""
        pass
    
    def get_metrics(self) -> Dict:
        """Get performance metrics"""  
        pass
```

## 🔍 Code Review Process

### For Contributors
1. Ensure all tests pass
2. Update documentation as needed  
3. Follow coding style guidelines
4. Respond promptly to feedback
5. Keep PRs focused and reasonably sized

### Review Criteria
- **Functionality**: Does it work as intended?
- **Code Quality**: Is it readable, maintainable?
- **Performance**: Does it affect system performance?
- **Security**: Are there any security implications?
- **Documentation**: Is it properly documented?

## 🏷️ Release Process

### Versioning
We use [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features, backward compatible  
- **PATCH**: Bug fixes, backward compatible

### Release Schedule
- **Patch releases**: As needed for critical bugs
- **Minor releases**: Monthly with new features
- **Major releases**: Quarterly or for significant changes

## 📞 Getting Help

### Development Questions
- **GitHub Discussions**: [Ask questions](https://github.com/020003/accelera/discussions)
- **Issues**: [Report problems](https://github.com/020003/accelera/issues)

### Real-time Help
- Check existing issues and discussions first
- Provide context, code samples, and error messages
- Be patient - this is a community-driven project

## 🙏 Recognition

Contributors will be recognized in:
- **README.md** acknowledgments section
- **CONTRIBUTORS.md** file (created automatically)
- Release notes for significant contributions
- GitHub contributor graphs and statistics

## 📜 Code of Conduct

Please note that this project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to abide by its terms.

## ❓ Questions?

Don't hesitate to ask! The best way to contribute is to start, even with small changes. Every contribution, no matter how small, is valuable and appreciated.

Happy coding! 🚀