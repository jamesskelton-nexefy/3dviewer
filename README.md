# 3D Model Viewer

A professional-grade 3D model viewer with advanced collaboration features, version control for 3D models, and real-time performance optimization. Built with Babylon.js, React, TypeScript, and Supabase.

## Features

### Core 3D Viewing
- **Advanced 3D Rendering**: Powered by Babylon.js for enterprise-grade visualization
- **Model Format Support**: GLTF/GLB file format with Draco compression
- **Interactive Controls**: Orbit, pan, and zoom with smooth camera controls
- **Performance Optimization**: 
  - Automatic quality adjustment to maintain 60 FPS
  - Progressive loading for large models
  - Texture compression and optimization
  - Real-time performance metrics display

### Version Control for 3D Models
- **Git-like Workflow**: Branch, commit, merge, and track changes to 3D models
- **Semantic Versioning**: Automatic version numbering (major.minor.patch)
- **Conflict Resolution**: Intelligent handling of geometry, material, and transform conflicts
- **Approval Workflows**: Require reviews before merging changes
- **Model Comparison**: Compare different versions with similarity scoring

### Collaboration & Security
- **Real-time Collaboration**: WebSocket support for live updates
- **Authentication**: Complete auth system with JWT tokens via Supabase
- **Role-Based Access**: Admin, Collaborator, and Viewer roles
- **Secure Sharing**: Generate expiring share links with access controls
- **Audit Trail**: Track all changes and user activities

### Performance & Storage
- **Cloud Storage**: Secure model storage with Supabase
- **File Compression**: Optional Draco compression for reduced storage
- **Progressive Loading**: Stream large models as they download
- **Size Limits**: 100MB maximum model size (configurable)

## Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- Supabase account (for authentication and storage features)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd 3dviewer
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

4. Configure your `.env` file with your Supabase credentials:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

5. Set up Supabase database (if using version control features):
```bash
# Run the SQL scripts in src/services/supabase/schema.sql and src/services/version-control/schema.sql
```

## Development

Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run test` - Run tests
- `npm run test:ui` - Run tests with UI
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint errors
- `npm run typecheck` - Run TypeScript type checking
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting

## Project Structure

```
3dviewer/
├── src/
│   ├── components/       # React components
│   │   ├── viewer/      # 3D viewer components
│   │   ├── annotations/ # Annotation system
│   │   └── collaboration/ # Collaboration features
│   ├── services/        # Core services
│   │   ├── 3d/         # 3D rendering services
│   │   ├── auth/       # Authentication
│   │   ├── version-control/ # Git-like version control
│   │   ├── optimization/ # Performance optimization
│   │   └── supabase/   # Supabase integration
│   ├── hooks/          # React hooks
│   ├── types/          # TypeScript type definitions
│   └── main.ts         # Application entry point
├── tests/              # Test suites
├── public/             # Static assets
└── package.json        # Project configuration
```

## Usage

### Basic Model Viewing
1. Open the application in your browser
2. Click "Upload Model" or drag and drop a GLTF/GLB file
3. Use mouse controls to interact with the model:
   - Left click + drag: Rotate
   - Right click + drag: Pan
   - Scroll: Zoom

### Version Control
1. Create a new branch for your changes
2. Upload or modify a model
3. Commit changes with a descriptive message
4. Create a merge request for review
5. Merge approved changes to main branch

### Collaboration
1. Share your model using the share button
2. Set expiration time and access permissions
3. Collaborators can view and comment in real-time
4. Track all activities in the activity feed

## Testing

Run the test suite:
```bash
# Run all tests
npm run test

# Run with UI
npm run test:ui

# Generate coverage report
npm run test:coverage
```

## Building for Production

```bash
# Build the application
npm run build

# Preview the production build
npm run preview
```

## Performance Tips

- Enable Draco compression for large models
- Use texture compression for models with many textures
- Set appropriate LOD (Level of Detail) settings
- Monitor performance metrics in the UI
- Adjust quality settings based on device capabilities

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Babylon.js](https://www.babylonjs.com/) - 3D rendering engine
- [Supabase](https://supabase.com/) - Backend infrastructure
- [Vite](https://vitejs.dev/) - Build tooling
- [React](https://reactjs.org/) - UI framework