import * as BABYLON from '@babylonjs/core';
import { Mesh, Vector3, VertexData } from '@babylonjs/core';

export interface SimplificationOptions {
  targetVertices?: number;
  targetPercentage?: number;
  preserveBoundary: boolean;
  preserveTopology: boolean;
  preserveTexCoords: boolean;
  quality: number; // 0-1, higher = better quality
  maxIterations: number;
}

export interface SimplificationResult {
  originalVertices: number;
  simplifiedVertices: number;
  reductionPercentage: number;
  errorMetric: number;
  timeTaken: number;
}

interface Vertex {
  position: Vector3;
  normal?: Vector3;
  uv?: BABYLON.Vector2;
  quadric: number[][];
  edges: Set<number>;
  faces: Set<number>;
  boundary: boolean;
}

interface Edge {
  v1: number;
  v2: number;
  cost: number;
  targetPosition: Vector3;
}

interface Face {
  v1: number;
  v2: number;
  v3: number;
  normal: Vector3;
}

export class MeshSimplification {
  private vertices: Vertex[] = [];
  private faces: Face[] = [];
  private edges: Map<string, Edge> = new Map();
  private edgeHeap: Edge[] = [];
  private options: SimplificationOptions;

  constructor(options?: Partial<SimplificationOptions>) {
    this.options = {
      preserveBoundary: options?.preserveBoundary ?? true,
      preserveTopology: options?.preserveTopology ?? true,
      preserveTexCoords: options?.preserveTexCoords ?? true,
      quality: options?.quality ?? 0.7,
      maxIterations: options?.maxIterations ?? 1000,
      ...options
    };
  }

  /**
   * Simplify mesh using quadric error metrics
   */
  public async simplifyMesh(
    mesh: Mesh,
    options?: Partial<SimplificationOptions>
  ): Promise<{ mesh: Mesh; result: SimplificationResult }> {
    const startTime = performance.now();
    const mergedOptions = { ...this.options, ...options };
    
    // Extract mesh data
    this.extractMeshData(mesh);
    
    // Calculate target vertex count
    const targetVertices = this.calculateTargetVertices(mergedOptions);
    
    // Initialize quadric error matrices
    this.initializeQuadrics();
    
    // Build edge heap
    this.buildEdgeHeap();
    
    // Perform edge collapses
    const errorMetric = await this.performSimplification(targetVertices, mergedOptions);
    
    // Create simplified mesh
    const simplifiedMesh = this.createSimplifiedMesh(mesh);
    
    const result: SimplificationResult = {
      originalVertices: mesh.getTotalVertices(),
      simplifiedVertices: this.vertices.filter(v => v !== null).length,
      reductionPercentage: 1 - (this.vertices.filter(v => v !== null).length / mesh.getTotalVertices()),
      errorMetric,
      timeTaken: performance.now() - startTime
    };

    return { mesh: simplifiedMesh, result };
  }

  /**
   * Extract vertex and face data from mesh
   */
  private extractMeshData(mesh: Mesh): void {
    const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const normals = mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
    const uvs = mesh.getVerticesData(BABYLON.VertexBuffer.UVKind);
    const indices = mesh.getIndices();
    
    if (!positions || !indices) {
      throw new Error('Mesh must have positions and indices');
    }

    // Clear previous data
    this.vertices = [];
    this.faces = [];
    this.edges.clear();

    // Create vertices
    const vertexCount = positions.length / 3;
    for (let i = 0; i < vertexCount; i++) {
      const vertex: Vertex = {
        position: new Vector3(
          positions[i * 3],
          positions[i * 3 + 1],
          positions[i * 3 + 2]
        ),
        quadric: this.createZeroMatrix(),
        edges: new Set(),
        faces: new Set(),
        boundary: false
      };

      if (normals) {
        vertex.normal = new Vector3(
          normals[i * 3],
          normals[i * 3 + 1],
          normals[i * 3 + 2]
        );
      }

      if (uvs) {
        vertex.uv = new BABYLON.Vector2(
          uvs[i * 2],
          uvs[i * 2 + 1]
        );
      }

      this.vertices.push(vertex);
    }

    // Create faces and detect boundaries
    const edgeCount: Map<string, number> = new Map();
    
    for (let i = 0; i < indices.length; i += 3) {
      const v1 = indices[i];
      const v2 = indices[i + 1];
      const v3 = indices[i + 2];

      const face: Face = {
        v1, v2, v3,
        normal: this.calculateFaceNormal(
          this.vertices[v1].position,
          this.vertices[v2].position,
          this.vertices[v3].position
        )
      };

      this.faces.push(face);
      const faceIndex = this.faces.length - 1;

      // Update vertex references
      this.vertices[v1].faces.add(faceIndex);
      this.vertices[v2].faces.add(faceIndex);
      this.vertices[v3].faces.add(faceIndex);

      // Track edges for boundary detection
      this.countEdge(edgeCount, v1, v2);
      this.countEdge(edgeCount, v2, v3);
      this.countEdge(edgeCount, v3, v1);
    }

    // Mark boundary vertices
    edgeCount.forEach((count, edgeKey) => {
      if (count === 1) {
        const [v1, v2] = edgeKey.split('-').map(Number);
        this.vertices[v1].boundary = true;
        this.vertices[v2].boundary = true;
      }
    });
  }

  /**
   * Count edge occurrences for boundary detection
   */
  private countEdge(edgeCount: Map<string, number>, v1: number, v2: number): void {
    const key = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
    edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
  }

  /**
   * Calculate face normal
   */
  private calculateFaceNormal(v1: Vector3, v2: Vector3, v3: Vector3): Vector3 {
    const edge1 = v2.subtract(v1);
    const edge2 = v3.subtract(v1);
    return Vector3.Cross(edge1, edge2).normalize();
  }

  /**
   * Initialize quadric error matrices for all vertices
   */
  private initializeQuadrics(): void {
    // Reset quadrics
    this.vertices.forEach(vertex => {
      vertex.quadric = this.createZeroMatrix();
    });

    // Calculate quadrics from face planes
    this.faces.forEach(face => {
      const plane = this.getPlaneFromFace(face);
      const quadric = this.createQuadricFromPlane(plane);

      // Add quadric to face vertices
      this.vertices[face.v1].quadric = this.addMatrices(
        this.vertices[face.v1].quadric,
        quadric
      );
      this.vertices[face.v2].quadric = this.addMatrices(
        this.vertices[face.v2].quadric,
        quadric
      );
      this.vertices[face.v3].quadric = this.addMatrices(
        this.vertices[face.v3].quadric,
        quadric
      );
    });
  }

  /**
   * Get plane equation from face
   */
  private getPlaneFromFace(face: Face): number[] {
    const v1 = this.vertices[face.v1].position;
    const normal = face.normal;
    const d = -Vector3.Dot(normal, v1);
    return [normal.x, normal.y, normal.z, d];
  }

  /**
   * Create quadric matrix from plane
   */
  private createQuadricFromPlane(plane: number[]): number[][] {
    const [a, b, c, d] = plane;
    return [
      [a * a, a * b, a * c, a * d],
      [a * b, b * b, b * c, b * d],
      [a * c, b * c, c * c, c * d],
      [a * d, b * d, c * d, d * d]
    ];
  }

  /**
   * Create zero matrix
   */
  private createZeroMatrix(): number[][] {
    return [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0]
    ];
  }

  /**
   * Add two matrices
   */
  private addMatrices(m1: number[][], m2: number[][]): number[][] {
    const result: number[][] = [];
    for (let i = 0; i < 4; i++) {
      result[i] = [];
      for (let j = 0; j < 4; j++) {
        result[i][j] = m1[i][j] + m2[i][j];
      }
    }
    return result;
  }

  /**
   * Build edge heap with collapse costs
   */
  private buildEdgeHeap(): void {
    this.edges.clear();
    this.edgeHeap = [];

    // Create edges from faces
    this.faces.forEach(face => {
      this.createEdge(face.v1, face.v2);
      this.createEdge(face.v2, face.v3);
      this.createEdge(face.v3, face.v1);
    });

    // Convert to array and sort by cost
    this.edgeHeap = Array.from(this.edges.values());
    this.sortEdgeHeap();
  }

  /**
   * Create edge and calculate collapse cost
   */
  private createEdge(v1: number, v2: number): void {
    const key = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
    if (this.edges.has(key)) return;

    const vertex1 = this.vertices[v1];
    const vertex2 = this.vertices[v2];
    
    vertex1.edges.add(v2);
    vertex2.edges.add(v1);

    const edge: Edge = {
      v1: v1 < v2 ? v1 : v2,
      v2: v1 < v2 ? v2 : v1,
      cost: 0,
      targetPosition: new Vector3()
    };

    // Calculate optimal collapse position and cost
    const { position, cost } = this.calculateOptimalPosition(vertex1, vertex2);
    edge.targetPosition = position;
    edge.cost = cost;

    this.edges.set(key, edge);
  }

  /**
   * Calculate optimal position for edge collapse
   */
  private calculateOptimalPosition(
    v1: Vertex,
    v2: Vertex
  ): { position: Vector3; cost: number } {
    // Combine quadrics
    const combinedQuadric = this.addMatrices(v1.quadric, v2.quadric);
    
    // Try to solve for optimal position
    const optimalPos = this.solveOptimalPosition(combinedQuadric);
    
    if (optimalPos) {
      const cost = this.calculateQuadricError(optimalPos, combinedQuadric);
      return { position: optimalPos, cost };
    }

    // Fallback: test endpoints and midpoint
    const positions = [
      v1.position,
      v2.position,
      v1.position.add(v2.position).scale(0.5)
    ];

    let minCost = Infinity;
    let bestPos = positions[0];

    positions.forEach(pos => {
      const cost = this.calculateQuadricError(pos, combinedQuadric);
      if (cost < minCost) {
        minCost = cost;
        bestPos = pos;
      }
    });

    return { position: bestPos, cost: minCost };
  }

  /**
   * Solve for optimal position using quadric
   */
  private solveOptimalPosition(quadric: number[][]): Vector3 | null {
    // Solve linear system Ax = b
    // This is a simplified implementation
    // In production, use a proper linear algebra library
    
    const a = [
      [quadric[0][0], quadric[0][1], quadric[0][2]],
      [quadric[1][0], quadric[1][1], quadric[1][2]],
      [quadric[2][0], quadric[2][1], quadric[2][2]]
    ];
    
    const b = [-quadric[0][3], -quadric[1][3], -quadric[2][3]];
    
    // Check if matrix is invertible
    const det = this.determinant3x3(a);
    if (Math.abs(det) < 0.0001) return null;
    
    // Solve using Cramer's rule
    const x = this.solveLinear3x3(a, b);
    return x ? new Vector3(x[0], x[1], x[2]) : null;
  }

  /**
   * Calculate 3x3 determinant
   */
  private determinant3x3(m: number[][]): number {
    return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
           m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
           m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  }

  /**
   * Solve 3x3 linear system
   */
  private solveLinear3x3(a: number[][], b: number[]): number[] | null {
    const det = this.determinant3x3(a);
    if (Math.abs(det) < 0.0001) return null;

    // Cramer's rule
    const x = this.determinant3x3([
      [b[0], a[0][1], a[0][2]],
      [b[1], a[1][1], a[1][2]],
      [b[2], a[2][1], a[2][2]]
    ]) / det;

    const y = this.determinant3x3([
      [a[0][0], b[0], a[0][2]],
      [a[1][0], b[1], a[1][2]],
      [a[2][0], b[2], a[2][2]]
    ]) / det;

    const z = this.determinant3x3([
      [a[0][0], a[0][1], b[0]],
      [a[1][0], a[1][1], b[1]],
      [a[2][0], a[2][1], b[2]]
    ]) / det;

    return [x, y, z];
  }

  /**
   * Calculate quadric error for position
   */
  private calculateQuadricError(pos: Vector3, quadric: number[][]): number {
    const v = [pos.x, pos.y, pos.z, 1];
    let error = 0;
    
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        error += v[i] * quadric[i][j] * v[j];
      }
    }
    
    return Math.abs(error);
  }

  /**
   * Sort edge heap by cost
   */
  private sortEdgeHeap(): void {
    this.edgeHeap.sort((a, b) => a.cost - b.cost);
  }

  /**
   * Calculate target vertex count
   */
  private calculateTargetVertices(options: SimplificationOptions): number {
    if (options.targetVertices) {
      return options.targetVertices;
    } else if (options.targetPercentage) {
      return Math.floor(this.vertices.length * options.targetPercentage);
    } else {
      return Math.floor(this.vertices.length * 0.5); // Default 50%
    }
  }

  /**
   * Perform mesh simplification
   */
  private async performSimplification(
    targetVertices: number,
    options: SimplificationOptions
  ): Promise<number> {
    let currentVertices = this.vertices.length;
    let iterations = 0;
    let totalError = 0;

    while (currentVertices > targetVertices && 
           iterations < options.maxIterations && 
           this.edgeHeap.length > 0) {
      
      // Get edge with minimum cost
      const edge = this.edgeHeap.shift()!;
      
      // Skip if vertices already collapsed
      if (!this.vertices[edge.v1] || !this.vertices[edge.v2]) {
        continue;
      }

      // Check constraints
      if (!this.canCollapse(edge, options)) {
        continue;
      }

      // Perform edge collapse
      this.collapseEdge(edge);
      currentVertices--;
      iterations++;
      totalError += edge.cost;

      // Update affected edges
      this.updateAffectedEdges(edge.v1);

      // Re-sort heap periodically
      if (iterations % 100 === 0) {
        this.sortEdgeHeap();
      }

      // Yield periodically to prevent blocking
      if (iterations % 50 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    return totalError / iterations;
  }

  /**
   * Check if edge can be collapsed
   */
  private canCollapse(edge: Edge, options: SimplificationOptions): boolean {
    const v1 = this.vertices[edge.v1];
    const v2 = this.vertices[edge.v2];

    // Preserve boundary constraint
    if (options.preserveBoundary && (v1.boundary || v2.boundary)) {
      if (!(v1.boundary && v2.boundary)) {
        return false;
      }
    }

    // Preserve topology constraint
    if (options.preserveTopology) {
      // Check if collapse would create non-manifold geometry
      const commonNeighbors = this.getCommonNeighbors(edge.v1, edge.v2);
      if (commonNeighbors.length > 2) {
        return false;
      }
    }

    // Quality constraint
    if (edge.cost > (1 - options.quality) * 10) {
      return false;
    }

    return true;
  }

  /**
   * Get common neighbors of two vertices
   */
  private getCommonNeighbors(v1: number, v2: number): number[] {
    const neighbors1 = this.vertices[v1].edges;
    const neighbors2 = this.vertices[v2].edges;
    const common: number[] = [];

    neighbors1.forEach(n => {
      if (neighbors2.has(n) && n !== v1 && n !== v2) {
        common.push(n);
      }
    });

    return common;
  }

  /**
   * Collapse edge
   */
  private collapseEdge(edge: Edge): void {
    const v1 = this.vertices[edge.v1];
    const v2 = this.vertices[edge.v2];

    // Move v1 to target position
    v1.position = edge.targetPosition.clone();
    
    // Update v1's quadric
    v1.quadric = this.addMatrices(v1.quadric, v2.quadric);

    // Transfer v2's connections to v1
    v2.faces.forEach(faceIdx => {
      const face = this.faces[faceIdx];
      if (face.v1 === edge.v2) face.v1 = edge.v1;
      if (face.v2 === edge.v2) face.v2 = edge.v1;
      if (face.v3 === edge.v2) face.v3 = edge.v1;
      
      // Skip degenerate faces
      if (face.v1 === face.v2 || face.v2 === face.v3 || face.v3 === face.v1) {
        this.faces[faceIdx] = null as any;
      } else {
        v1.faces.add(faceIdx);
      }
    });

    // Update edges
    v2.edges.forEach(neighbor => {
      if (neighbor !== edge.v1) {
        v1.edges.add(neighbor);
        this.vertices[neighbor].edges.delete(edge.v2);
        this.vertices[neighbor].edges.add(edge.v1);
      }
    });

    // Remove v2
    this.vertices[edge.v2] = null as any;
  }

  /**
   * Update affected edges after collapse
   */
  private updateAffectedEdges(vertex: number): void {
    const v = this.vertices[vertex];
    if (!v) return;

    v.edges.forEach(neighbor => {
      const key = vertex < neighbor ? `${vertex}-${neighbor}` : `${neighbor}-${vertex}`;
      const edge = this.edges.get(key);
      
      if (edge) {
        // Recalculate cost
        const { position, cost } = this.calculateOptimalPosition(
          this.vertices[vertex],
          this.vertices[neighbor]
        );
        edge.targetPosition = position;
        edge.cost = cost;
      }
    });
  }

  /**
   * Create simplified mesh from processed data
   */
  private createSimplifiedMesh(originalMesh: Mesh): Mesh {
    // Build vertex mapping
    const vertexMap = new Map<number, number>();
    const newPositions: number[] = [];
    const newNormals: number[] = [];
    const newUVs: number[] = [];
    let newIndex = 0;

    this.vertices.forEach((vertex, oldIndex) => {
      if (vertex) {
        vertexMap.set(oldIndex, newIndex);
        
        newPositions.push(vertex.position.x, vertex.position.y, vertex.position.z);
        
        if (vertex.normal) {
          newNormals.push(vertex.normal.x, vertex.normal.y, vertex.normal.z);
        }
        
        if (vertex.uv) {
          newUVs.push(vertex.uv.x, vertex.uv.y);
        }
        
        newIndex++;
      }
    });

    // Build new indices
    const newIndices: number[] = [];
    this.faces.forEach(face => {
      if (face) {
        const v1 = vertexMap.get(face.v1);
        const v2 = vertexMap.get(face.v2);
        const v3 = vertexMap.get(face.v3);
        
        if (v1 !== undefined && v2 !== undefined && v3 !== undefined) {
          newIndices.push(v1, v2, v3);
        }
      }
    });

    // Create new mesh
    const simplifiedMesh = new Mesh(
      `${originalMesh.name}_simplified`,
      originalMesh.getScene()
    );

    const vertexData = new VertexData();
    vertexData.positions = newPositions;
    vertexData.indices = newIndices;
    
    if (newNormals.length > 0) {
      vertexData.normals = newNormals;
    } else {
      VertexData.ComputeNormals(newPositions, newIndices, newNormals);
      vertexData.normals = newNormals;
    }
    
    if (newUVs.length > 0) {
      vertexData.uvs = newUVs;
    }

    vertexData.applyToMesh(simplifiedMesh);

    // Copy material
    if (originalMesh.material) {
      simplifiedMesh.material = originalMesh.material;
    }

    // Copy transform
    simplifiedMesh.position = originalMesh.position.clone();
    simplifiedMesh.rotation = originalMesh.rotation.clone();
    simplifiedMesh.scaling = originalMesh.scaling.clone();

    return simplifiedMesh;
  }

  /**
   * Simplify multiple meshes in batch
   */
  public async simplifyMeshBatch(
    meshes: Mesh[],
    options?: Partial<SimplificationOptions>
  ): Promise<{ mesh: Mesh; result: SimplificationResult }[]> {
    const results = await Promise.all(
      meshes.map(mesh => this.simplifyMesh(mesh, options))
    );
    return results;
  }
}